/* E9-T01 frozen guest workload, not an implemented GPU adapter or a passing proof.
 * Compile for RV64 Linux with the qualified renderer's EGL/GLES2 headers/libraries.
 * Invoke inside its real guest desktop. T17/T18 must pin the compiler, binary and
 * renderer receipt before admitting this profile. Never execute this on the host
 * and claim a guest result. A missing context or GL error is a qualification failure.
 */
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <stdio.h>

int main(void) {
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLConfig config;
    EGLint count = 0;
    const EGLint attributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
    const EGLint size[] = {EGL_WIDTH, 4, EGL_HEIGHT, 4, EGL_NONE};
    const EGLint version[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, NULL, NULL) ||
        !eglBindAPI(EGL_OPENGL_ES_API) ||
        !eglChooseConfig(display, attributes, &config, 1, &count) || count != 1)
        return 2;
    EGLSurface surface = eglCreatePbufferSurface(display, config, size);
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, version);
    if (surface == EGL_NO_SURFACE || context == EGL_NO_CONTEXT ||
        !eglMakeCurrent(display, surface, surface, context))
        return 3;
    const GLubyte *renderer = glGetString(GL_RENDERER);
    if (renderer == NULL)
        return 5;
    printf("E9_GPU_RENDERER=%s\n", (const char *)renderer);
    unsigned char rgba[4 * 4 * 4] = {0};
    glViewport(0, 0, 4, 4);
    glClearColor(1.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glFinish();
    glReadPixels(0, 0, 4, 4, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    GLenum error = glGetError();
    printf("E9_GPU_ERROR=%u\nE9_GPU_RGBA=", (unsigned int)error);
    for (unsigned int i = 0; i < sizeof(rgba); ++i)
        printf("%02x", rgba[i]);
    putchar('\n');
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context);
    eglDestroySurface(display, surface);
    eglTerminate(display);
    return error == GL_NO_ERROR ? 0 : 4;
}
