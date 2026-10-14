/* Independent mandatory GLES3 query admission; never block on QUERY_RESULT. */
#define _POSIX_C_SOURCE 200809L
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

typedef const unsigned char *(*string_fn)(unsigned int);
typedef unsigned int (*error_fn)(void);
typedef void (*gen_fn)(int, unsigned int *);
typedef void (*delete_fn)(int, const unsigned int *);
typedef void (*begin_fn)(unsigned int, unsigned int);
typedef void (*end_fn)(unsigned int);
typedef void (*get_query_fn)(unsigned int, unsigned int, unsigned int *);
typedef void (*flush_fn)(void);

static void deadline(int signal_number) {
    (void)signal_number;
    static const char message[] = "GL_QUERY_PROBE_TIMEOUT\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(124);
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGALRM, deadline);
    alarm(30);
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_GBM_KHR, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
    EGLint major = 0, minor = 0;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) || !eglBindAPI(EGL_OPENGL_ES_API)) {
        printf("QUERY_INIT_FAIL error=0x%x\n", eglGetError());
        return 2;
    }
    const EGLint attributes[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, 3, EGL_CONTEXT_MINOR_VERSION_KHR, 0, EGL_NONE};
    EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) {
        printf("QUERY_CONTEXT_FAIL error=0x%x\n", eglGetError());
        return 3;
    }
    string_fn string = (string_fn)eglGetProcAddress("glGetString");
    error_fn error = (error_fn)eglGetProcAddress("glGetError");
    gen_fn generate = (gen_fn)eglGetProcAddress("glGenQueries");
    delete_fn destroy = (delete_fn)eglGetProcAddress("glDeleteQueries");
    begin_fn begin = (begin_fn)eglGetProcAddress("glBeginQuery");
    end_fn end = (end_fn)eglGetProcAddress("glEndQuery");
    get_query_fn get = (get_query_fn)eglGetProcAddress("glGetQueryObjectuiv");
    flush_fn flush = (flush_fn)eglGetProcAddress("glFlush");
    if (!string || !error || !generate || !destroy || !begin || !end || !get || !flush) return 4;
    const char *renderer = (const char *)string(0x1f01);
    const char *version = (const char *)string(0x1f02);
    printf("QUERY_RENDERER=%s\nQUERY_VERSION=%s\n", renderer ? renderer : "<null>", version ? version : "<null>");
    int failures = !renderer || !version || !strstr(renderer, "virgl") ||
        strstr(renderer, "llvmpipe") || strstr(renderer, "softpipe") || !strstr(version, "OpenGL ES 3.0");
    const unsigned int targets[] = {0x8c2f, 0x8d6a, 0x8c88};
    const char *names[] = {"ANY_SAMPLES_PASSED", "ANY_SAMPLES_PASSED_CONSERVATIVE", "TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN"};
    for (unsigned int i = 0; i < sizeof(targets) / sizeof(targets[0]); i++) {
        unsigned int query = 0;
        generate(1, &query);
        unsigned int generated_error = error();
        printf("QUERY_GENERATE target=%s id=%u error=0x%x\n", names[i], query, generated_error);
        if (!query || generated_error) { failures++; continue; }
        begin(targets[i], query);
        unsigned int begin_error = error();
        printf("QUERY_BEGIN target=%s error=0x%x\n", names[i], begin_error);
        if (begin_error) { failures++; destroy(1, &query); (void)error(); continue; }
        end(targets[i]);
        unsigned int end_error = error();
        printf("QUERY_END target=%s error=0x%x\n", names[i], end_error);
        if (end_error) failures++;
        flush();
        unsigned int available = 0;
        get(query, 0x8867, &available); /* Only QUERY_RESULT_AVAILABLE, no waiting result read. */
        unsigned int available_error = error();
        printf("QUERY_AVAILABLE target=%s available=%u error=0x%x\n", names[i], available, available_error);
        if (available_error) failures++;
        destroy(1, &query);
        unsigned int delete_error = error();
        printf("QUERY_DELETE target=%s error=0x%x\n", names[i], delete_error);
        if (delete_error) failures++;
    }
    printf("QUERY_ADMISSION_%s failures=%d (result correctness remains separate)\n", failures ? "FAIL" : "PASS", failures);
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context);
    eglTerminate(display);
    alarm(0);
    return failures ? 5 : 0;
}
