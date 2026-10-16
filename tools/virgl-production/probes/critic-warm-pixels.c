/* Independent fresh GLES workload after GPU warm restore: four literal 4x4 quadrants. */
#define _POSIX_C_SOURCE 200809L
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int failures;
static void deadline(int number) {
    (void)number;
    const char message[] = "WARM_PIXELS_TIMEOUT\n";
    (void)write(STDERR_FILENO, message, sizeof(message)-1);
    _exit(124);
}
static int check(const char *where) {
    GLenum error = glGetError();
    if (error == GL_NO_ERROR) return 1;
    printf("WARM_PIXELS_GL_ERROR where=%s error=0x%x\n", where, error);
    failures++;
    return 0;
}
static GLuint compile(GLenum stage, const char *source) {
    GLuint shader = glCreateShader(stage);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        printf("WARM_PIXELS_SHADER_FAIL stage=0x%x log=%s\n", stage, log);
        failures++;
    }
    return shader;
}
int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGALRM, deadline);
    alarm(90);
    unsigned int seed = 5;
    if (argc > 1) {
        if (argc != 2 || argv[1][0] < '0' || argv[1][0] > '7' || argv[1][1] != '\0') return 64;
        seed = (unsigned int)(argv[1][0]-'0');
    }
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_GBM_KHR, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
    EGLint major=0, minor=0;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) || !eglBindAPI(EGL_OPENGL_ES_API)) return 2;
    const EGLint attributes[] = {EGL_CONTEXT_MAJOR_VERSION_KHR,3,EGL_CONTEXT_MINOR_VERSION_KHR,0,EGL_NONE};
    EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display,EGL_NO_SURFACE,EGL_NO_SURFACE,context)) return 3;
    const char *renderer=(const char *)glGetString(GL_RENDERER), *version=(const char *)glGetString(GL_VERSION);
    printf("WARM_PIXELS_RENDERER=%s\nWARM_PIXELS_VERSION=%s\n", renderer?renderer:"<null>", version?version:"<null>");
    if (!renderer || !version || !strstr(renderer,"virgl") || strstr(renderer,"llvmpipe") || strstr(renderer,"softpipe") || !strstr(version,"OpenGL ES 3.0")) return 4;
    GLuint texture=0, framebuffer=0, buffer=0, vao=0;
    glGenTextures(1,&texture);glBindTexture(GL_TEXTURE_2D,texture);glTexStorage2D(GL_TEXTURE_2D,1,GL_RGBA8,8,8);
    glGenFramebuffers(1,&framebuffer);glBindFramebuffer(GL_FRAMEBUFFER,framebuffer);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE || !check("framebuffer")) return 5;
    const GLfloat vertices[]={-1,-1,3,-1,-1,3};
    glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&buffer);glBindBuffer(GL_ARRAY_BUFFER,buffer);glBufferData(GL_ARRAY_BUFFER,sizeof(vertices),vertices,GL_STATIC_DRAW);
    glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,NULL);glEnableVertexAttribArray(0);
    const char *vs="#version 300 es\nlayout(location=0) in vec2 p;void main(){gl_Position=vec4(p,0,1);}\n";
    const char *fs="#version 300 es\nprecision highp float;uniform vec4 ink;out vec4 c;void main(){c=ink;}\n";
    GLuint vertex=compile(GL_VERTEX_SHADER,vs), fragment=compile(GL_FRAGMENT_SHADER,fs), program=glCreateProgram();
    glAttachShader(program,vertex);glAttachShader(program,fragment);glLinkProgram(program);
    GLint linked=0;glGetProgramiv(program,GL_LINK_STATUS,&linked);
    if (!linked || failures || !check("program")) return 6;
    glUseProgram(program);GLint ink=glGetUniformLocation(program,"ink");
    if (ink<0) return 7;
    glViewport(0,0,8,8);glDisable(GL_BLEND);glDisable(GL_CULL_FACE);glDisable(GL_DEPTH_TEST);glDisable(GL_DITHER);glDisable(GL_SCISSOR_TEST);
    glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_SCISSOR_TEST);
    const unsigned int masks[]={1,2,4,3};
    for (unsigned int q=0;q<4;q++) {
        unsigned int bits=masks[q]^seed;
        glScissor((GLint)(q%2)*4,(GLint)(q/2)*4,4,4);
        glUniform4f(ink,(bits&1)?1.0f:0.0f,(bits&2)?1.0f:0.0f,(bits&4)?1.0f:0.0f,1.0f);
        glDrawArrays(GL_TRIANGLES,0,3);
        (void)check("fresh triangle");
    }
    glDisable(GL_SCISSOR_TEST);glFinish();
    unsigned char pixels[256];memset(pixels,0xa7,sizeof(pixels));glReadPixels(0,0,8,8,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
    (void)check("readback");
    printf("WARM_PIXELS_BYTES=");for (unsigned int i=0;i<sizeof(pixels);i++) printf("%02x",pixels[i]);printf("\n");
    unsigned int differences=0;
    for (unsigned int y=0;y<8;y++) for (unsigned int x=0;x<8;x++) {
        unsigned int q=(y/4)*2+x/4,bits=masks[q]^seed;
        const unsigned char expected[]={(bits&1)?255:0,(bits&2)?255:0,(bits&4)?255:0,255};
        for (unsigned int lane=0;lane<4;lane++) if (pixels[(y*8+x)*4+lane]!=expected[lane]) {
            if (differences<8) printf("WARM_PIXELS_DIFFERENT x=%u y=%u lane=%u actual=%u expected=%u\n",x,y,lane,pixels[(y*8+x)*4+lane],expected[lane]);
            differences++;
        }
    }
    if (differences) failures++;
    printf("WARM_PIXELS_RESULT seed=%u pixels=64 bytes=256 draws=4 different=%u\n",seed,differences);
    glDeleteProgram(program);glDeleteShader(vertex);glDeleteShader(fragment);glDeleteBuffers(1,&buffer);glDeleteVertexArrays(1,&vao);glDeleteFramebuffers(1,&framebuffer);glDeleteTextures(1,&texture);
    (void)check("cleanup");eglMakeCurrent(display,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT);eglDestroyContext(display,context);eglTerminate(display);alarm(0);
    printf("WARM_PIXELS_%s failures=%d\n",failures?"FAIL":"PASS",failures);
    return failures?8:0;
}
