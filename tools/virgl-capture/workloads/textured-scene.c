/* SPDX-License-Identifier: MIT
 * Literal independent pixel oracle for the guest VirGL capture workload.
 * No window-system compositor, reference GLSL translator, or generated golden
 * image participates in deciding the expected colors. */
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <gbm.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define REQUIRE(test, message) do { if (!(test)) { \
   fprintf(stderr, "TEXTURED_SCENE_FAIL %s line=%d egl=0x%x gl=0x%x\n", \
           message, __LINE__, eglGetError(), glGetError()); exit(1); } } while (0)

static GLuint shader(GLenum kind, const char *source)
{
   GLuint result = glCreateShader(kind);
   glShaderSource(result, 1, &source, NULL);
   glCompileShader(result);
   GLint ok = 0;
   glGetShaderiv(result, GL_COMPILE_STATUS, &ok);
   if (!ok) { char log[4096]; glGetShaderInfoLog(result, sizeof(log), NULL, log); fprintf(stderr, "%s\n", log); }
   REQUIRE(ok, "shader compile");
   return result;
}

static void pixels(unsigned phase, const unsigned char expected[4][4])
{
   unsigned char image[32 * 32 * 4];
   glReadPixels(0, 0, 32, 32, GL_RGBA, GL_UNSIGNED_BYTE, image);
   REQUIRE(glGetError() == GL_NO_ERROR, "read pixels");
   unsigned checked = 0;
   for (unsigned q = 0; q < 4; ++q) {
      unsigned x0 = 4 + 16 * (q % 2), y0 = 4 + 16 * (q / 2);
      for (unsigned y = y0; y < y0 + 8; ++y)
         for (unsigned x = x0; x < x0 + 8; ++x) {
            const unsigned char *actual = image + (y * 32 + x) * 4;
            if (memcmp(actual, expected[q], 4)) {
               fprintf(stderr, "PIXEL_MISMATCH phase=%u x=%u y=%u got=%u,%u,%u,%u expected=%u,%u,%u,%u\n",
                       phase, x, y, actual[0], actual[1], actual[2], actual[3],
                       expected[q][0], expected[q][1], expected[q][2], expected[q][3]);
               exit(1);
            }
            ++checked;
         }
   }
   printf("PIXELS_PASS phase=%u checked=%u\n", phase, checked);
   fflush(stdout);
}

int main(int argc, char **argv)
{
   REQUIRE(argc <= 2, "usage: virgl-textured-scene [render-node]");
   const char *node = argc == 2 ? argv[1] : "/dev/dri/renderD128";
   int fd = open(node, O_RDWR | O_CLOEXEC);
   REQUIRE(fd >= 0, "open render node");
   struct gbm_device *gbm = gbm_create_device(fd);
   REQUIRE(gbm, "GBM device");
   PFNEGLGETPLATFORMDISPLAYEXTPROC get_display = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
   REQUIRE(get_display, "EGL platform display entrypoint");
   EGLDisplay display = get_display(EGL_PLATFORM_GBM_KHR, gbm, NULL);
   EGLint major, minor;
   REQUIRE(display != EGL_NO_DISPLAY && eglInitialize(display, &major, &minor), "EGL GBM initialize");
   REQUIRE(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
   const char *extensions = eglQueryString(display, EGL_EXTENSIONS);
   REQUIRE(extensions && strstr(extensions, "EGL_KHR_surfaceless_context"), "surfaceless GBM context");
   const EGLint attributes[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
      EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8,
      EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
   EGLConfig config;
   EGLint count = 0;
   REQUIRE(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "RGBA EGL config");
   const EGLint context_attributes[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
   EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, context_attributes);
   REQUIRE(context != EGL_NO_CONTEXT && eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context), "GLES context");
   const char *renderer = (const char *)glGetString(GL_RENDERER);
   printf("TEXTURED_SCENE_BEGIN draws=3 node=%s\nEGL_VERSION=%d.%d\nGL_VERSION=%s\nGL_VENDOR=%s\nGL_RENDERER=%s\n",
          node, major, minor, glGetString(GL_VERSION), glGetString(GL_VENDOR), renderer);
   fflush(stdout);
   REQUIRE(renderer && strstr(renderer, "virgl"), "guest renderer must be virgl");

   const char *vs = "attribute vec2 position; attribute vec2 texcoord; varying vec2 uv; void main() { uv = texcoord; gl_Position = vec4(position, 0.0, 1.0); }";
   const char *fs = "precision highp float; varying vec2 uv; uniform sampler2D image; uniform vec4 tint; void main() { gl_FragColor = texture2D(image, uv) * tint; }";
   GLuint vert = shader(GL_VERTEX_SHADER, vs), frag = shader(GL_FRAGMENT_SHADER, fs);
   GLuint program = glCreateProgram();
   glAttachShader(program, vert); glAttachShader(program, frag);
   glBindAttribLocation(program, 0, "position"); glBindAttribLocation(program, 1, "texcoord");
   glLinkProgram(program);
   GLint linked = 0; glGetProgramiv(program, GL_LINK_STATUS, &linked);
   REQUIRE(linked, "program link"); glUseProgram(program);
   GLint tint = glGetUniformLocation(program, "tint");
   REQUIRE(tint >= 0, "tint uniform");
   glUniform1i(glGetUniformLocation(program, "image"), 0);
   const GLfloat vertices[] = {-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1};
   const GLushort indices[] = {0,1,2, 2,1,3};
   GLuint buffers[2]; glGenBuffers(2, buffers);
   glBindBuffer(GL_ARRAY_BUFFER, buffers[0]); glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffers[1]); glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);
   glEnableVertexAttribArray(0); glEnableVertexAttribArray(1);
   glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), NULL);
   glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), (void *)(2 * sizeof(GLfloat)));

   GLuint textures[2], fbo;
   glGenTextures(2, textures); glActiveTexture(GL_TEXTURE0);
   glBindTexture(GL_TEXTURE_2D, textures[1]);
   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 32, 32, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
   glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
   glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textures[1], 0);
   REQUIRE(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "RGBA framebuffer");
   glBindTexture(GL_TEXTURE_2D, textures[0]);
   const unsigned char texels[16] = {255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255};
   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, texels);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
   glViewport(0, 0, 32, 32); glDisable(GL_DITHER); glDisable(GL_BLEND);
   const unsigned char expected[3][4][4] = {
      {{255,0,0,255},{0,255,0,255},{0,0,255,255},{255,255,0,255}},
      {{255,0,0,255},{0,128,0,255},{0,0,0,255},{255,128,0,255}},
      /* Quarter alpha avoids the 127.5 halfway ambiguity at alpha=0.5:
       * 255*0.25=63.75 ->64; 255*0.75=191.25 ->191. The same bytes result
       * if the blend unit quantizes source alpha to 64/255 first. */
      {{64,0,191,255},{0,64,191,255},{0,0,255,255},{64,64,191,255}},
   };
   for (unsigned phase = 0; phase < 3; ++phase) {
      glClearColor(0, 0, 1, 1); glClear(GL_COLOR_BUFFER_BIT);
      glUniform4f(tint, 1, phase == 1 ? 0.5f : 1, phase == 1 ? 0 : 1, phase == 2 ? 0.25f : 1);
      if (phase == 2) {
         glEnable(GL_BLEND);
         glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
      }
      glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, NULL);
      glFinish();
      REQUIRE(glGetError() == GL_NO_ERROR, "textured draw");
      pixels(phase, expected[phase]);
   }
   glDeleteFramebuffers(1, &fbo); glDeleteTextures(2, textures); glDeleteBuffers(2, buffers);
   glDeleteProgram(program); glDeleteShader(vert); glDeleteShader(frag);
   eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
   eglDestroyContext(display, context); eglTerminate(display); gbm_device_destroy(gbm); close(fd);
   puts("TEXTURED_SCENE_END status=pass draws=3 checked_pixels=768");
   return 0;
}
