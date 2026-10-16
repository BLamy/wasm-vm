/* Independent real GLES boolean results, framebuffer bytes and bounded polling. */
#define _POSIX_C_SOURCE 200809L
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int failures;

static void deadline(int number) {
    (void)number;
    static const char message[] = "BOOLEAN_PROBE_TIMEOUT\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(124);
}

static int check(const char *label) {
    GLenum error = glGetError();
    if (error == GL_NO_ERROR) return 1;
    printf("BOOLEAN_GL_ERROR label=%s error=0x%x\n", label, error);
    failures++;
    return 0;
}

static GLuint compile(GLenum stage, const char *source) {
    GLuint shader = glCreateShader(stage);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint success = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char log[2048];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        printf("BOOLEAN_SHADER_FAIL stage=0x%x log=%s\n", stage, log);
        failures++;
    }
    return shader;
}

static double seconds(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now)) return 0;
    return (double)now.tv_sec + (double)now.tv_nsec / 1000000000.0;
}

static int result(GLuint query, GLuint *value, const char *label) {
    double started = seconds();
    const struct timespec pause = {0, 1000000};
    for (unsigned int attempt = 0; attempt < 2048; attempt++) {
        GLuint available = 2;
        glGetQueryObjectuiv(query, GL_QUERY_RESULT_AVAILABLE, &available);
        if (!check("AVAILABLE") || available > 1) return 0;
        if (available) {
            /* A result read occurs only after real AVAILABLE is true. */
            glGetQueryObjectuiv(query, GL_QUERY_RESULT, value);
            if (!check("RESULT")) return 0;
            printf("BOOLEAN_RESULT case=%s available=%u result=%u polls=%u\n",
                   label, available, *value, attempt + 1);
            return 1;
        }
        glFlush();
        if (seconds() - started > 20) break;
        (void)nanosleep(&pause, NULL);
    }
    printf("BOOLEAN_NOT_READY case=%s\n", label);
    failures++;
    return 0;
}

static void run(GLenum target, const char *name, unsigned int mode) {
    /* Modes: visible depth .5 < 1; rejected .5 < 0; empty query. */
    GLuint query = 0;
    glGenQueries(1, &query);
    glClearColor(0, 0, 1, 1);
    glDepthMask(GL_TRUE);
    glClearDepthf(mode == 1 ? 0 : 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glDepthMask(GL_FALSE);
    if (!check("case setup") || !query) return;
    glBeginQuery(target, query);
    if (!check("BEGIN")) { glDeleteQueries(1, &query); return; }
    if (mode != 2) glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    glEndQuery(target);
    glFlush();
    if (!check("DRAW_END")) { glDeleteQueries(1, &query); return; }
    char label[128];
    snprintf(label, sizeof(label), "%s/%s", name, mode == 0 ? "visible" : mode == 1 ? "depth-rejected" : "empty");
    GLuint value = 2;
    if (result(query, &value, label)) {
        int accepted = mode == 0 ? value == 1 : mode == 2 ? value == 0 :
            target == GL_ANY_SAMPLES_PASSED ? value == 0 : value <= 1;
        /* Conservative false positives are allowed by ES3.0.6 section4.1.6. */
        if (!accepted) { printf("BOOLEAN_WRONG_RESULT case=%s result=%u\n", label, value); failures++; }
    }
    unsigned char pixels[4 * 4 * 4];
    memset(pixels, 0xa5, sizeof(pixels));
    glReadPixels(0, 0, 4, 4, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    unsigned int good = 0;
    for (unsigned int at = 0; at < sizeof(pixels); at += 4) {
        const unsigned char expected[4] = {0, mode == 0 ? 255 : 0, mode == 0 ? 0 : 255, 255};
        if (!memcmp(pixels + at, expected, sizeof(expected))) good++;
    }
    printf("BOOLEAN_FRAME case=%s literal_pixels=%u/16\n", label, good);
    if (!check("readPixels") || good != 16) failures++;
    glDeleteQueries(1, &query);
    (void)check("DELETE");
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGALRM, deadline);
    alarm(60);
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_GBM_KHR, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
    EGLint major = 0, minor = 0;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) || !eglBindAPI(EGL_OPENGL_ES_API)) return 2;
    const EGLint attributes[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, 3, EGL_CONTEXT_MINOR_VERSION_KHR, 0, EGL_NONE};
    EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) return 3;
    const char *renderer = (const char *)glGetString(GL_RENDERER), *version = (const char *)glGetString(GL_VERSION);
    printf("BOOLEAN_RENDERER=%s\nBOOLEAN_VERSION=%s\n", renderer ? renderer : "<null>", version ? version : "<null>");
    if (!renderer || !version || !strstr(renderer, "virgl") || strstr(renderer, "llvmpipe") ||
        strstr(renderer, "softpipe") || !strstr(version, "OpenGL ES 3.0")) return 4;

    GLuint texture = 0, depth = 0, framebuffer = 0, vertices = 0, vao = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 4, 4);
    glGenRenderbuffers(1, &depth);
    glBindRenderbuffer(GL_RENDERBUFFER, depth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, 4, 4);
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depth);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE || !check("framebuffer")) return 5;
    const GLfloat positions[] = {-1,-1,0,1, 1,-1,0,1, -1,1,0,1, 1,1,0,1};
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(1, &vertices);
    glBindBuffer(GL_ARRAY_BUFFER, vertices);
    glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 4, GL_FLOAT, GL_FALSE, 16, NULL);
    const char *vertex_source = "#version 300 es\nlayout(location=0) in vec4 p;void main(){gl_Position=p;}\n";
    const char *fragment_source = "#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0,1,0,1);}\n";
    GLuint vertex_shader = compile(GL_VERTEX_SHADER, vertex_source), fragment_shader = compile(GL_FRAGMENT_SHADER, fragment_source);
    GLuint program = glCreateProgram();
    glAttachShader(program, vertex_shader);
    glAttachShader(program, fragment_shader);
    glLinkProgram(program);
    GLint linked = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (!linked || failures || !check("program")) return 6;
    glUseProgram(program);
    glViewport(0, 0, 4, 4);
    glDisable(GL_BLEND);
    glDisable(GL_CULL_FACE);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    for (unsigned int mode = 0; mode < 3; mode++) {
        run(GL_ANY_SAMPLES_PASSED, "strict", mode);
        run(GL_ANY_SAMPLES_PASSED_CONSERVATIVE, "conservative", mode);
    }
    /* The GLES-only profile must not expose optional desktop counter/timer targets. */
    const GLenum forbidden[] = {0x8914, 0x88bf};
    for (unsigned int at = 0; at < sizeof(forbidden) / sizeof(forbidden[0]); at++) {
        GLuint query = 0;
        glGenQueries(1, &query);
        glBeginQuery(forbidden[at], query);
        GLenum error = glGetError();
        printf("BOOLEAN_OPTIONAL_REFUSAL target=0x%x error=0x%x\n", forbidden[at], error);
        if (error != GL_INVALID_ENUM) { failures++; if (error == GL_NO_ERROR) glEndQuery(forbidden[at]); }
        glDeleteQueries(1, &query);
        (void)check("optional DELETE");
    }
    glDeleteProgram(program);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    glDeleteBuffers(1, &vertices);
    glDeleteVertexArrays(1, &vao);
    glDeleteFramebuffers(1, &framebuffer);
    glDeleteRenderbuffers(1, &depth);
    glDeleteTextures(1, &texture);
    (void)check("cleanup");
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context);
    eglTerminate(display);
    alarm(0);
    printf("BOOLEAN_PROBE_%s failures=%d\n", failures ? "FAIL" : "PASS", failures);
    return failures ? 7 : 0;
}
