/* Independent mandatory GLES query admission, logical feedback counts and captured bytes. */
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
#include <stdlib.h>

static int failures;

static void deadline(int number) {
    (void)number;
    static const char message[] = "FEEDBACK_PROBE_TIMEOUT\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(124);
}

static int check(const char *label) {
    GLenum error = glGetError();
    if (error == GL_NO_ERROR) return 1;
    printf("FEEDBACK_GL_ERROR label=%s error=0x%x\n", label, error);
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
        printf("FEEDBACK_SHADER_FAIL stage=0x%x log=%s\n", stage, log);
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
            printf("FEEDBACK_RESULT case=%s available=%u result=%u polls=%u\n",
                   label, available, *value, attempt + 1);
            return 1;
        }
        glFlush();
        if (seconds() - started > 20) break;
        (void)nanosleep(&pause, NULL);
    }
    printf("FEEDBACK_NOT_READY case=%s\n", label);
    failures++;
    return 0;
}


static const unsigned int triangle_order[] = {0,1,2,2,1,3,2,3,4};
static const unsigned int line_order[] = {0,1,1,2,2,3};
static const unsigned int point_order[] = {0,1,2,3,4};
static GLuint outputs[2];
static unsigned char expected[2][1024];

static void initialize_outputs(void) {
    memset(expected, 0xa7, sizeof(expected));
    for (unsigned int b = 0; b < 2; b++) {
        glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER, outputs[b]);
        glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER, sizeof(expected[b]), expected[b], GL_DYNAMIC_READ);
    }
    (void)check("initialize output buffers");
}

static void predict_words(unsigned int cursor, const unsigned int *order, unsigned int vertices) {
    const GLfloat factors[4] = {2,3,4,5};
    for (unsigned int b = 0; b < 2; b++) for (unsigned int i = 0; i < vertices; i++) {
        GLfloat value[4];
        for (unsigned int lane = 0; lane < 4; lane++)
            value[lane] = (GLfloat)(order[i] + 1 + lane * 10) * (b ? factors[lane] : 1);
        memcpy(expected[b] + 16 + (cursor + i) * 16, value, sizeof(value));
    }
}

static void capture_draw(GLenum primitive, GLenum mode, unsigned int count,
                         unsigned int cursor, unsigned int capacity,
                         const unsigned int *order, unsigned int written) {
    if (capacity) {
        for (unsigned int b = 0; b < 2; b++)
            glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER, b, outputs[b], 16 + cursor * 16, capacity * 16);
        glBeginTransformFeedback(primitive);
        if (!check("begin feedback")) return;
    }
    glDrawArrays(mode, 0, (GLsizei)count);
    if (capacity) glEndTransformFeedback();
    (void)check("draw feedback");
    predict_words(cursor, order, written);
}

static void mapped_words(const char *name) {
    for (unsigned int b = 0; b < 2; b++) {
        glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER, outputs[b]);
        void *mapped = glMapBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER, 0, sizeof(expected[b]), GL_MAP_READ_BIT);
        if (!mapped || !check("map feedback")) { failures++; continue; }
        unsigned int different = 0;
        for (unsigned int at = 0; at < sizeof(expected[b]); at++)
            if (((const unsigned char *)mapped)[at] != expected[b][at]) different++;
        printf("FEEDBACK_BYTES case=%s buffer=%u size=%zu different=%u\n", name, b, sizeof(expected[b]), different);
        GLboolean unmapped = glUnmapBuffer(GL_TRANSFORM_FEEDBACK_BUFFER);
        if (different || unmapped != GL_TRUE || !check("unmap feedback")) failures++;
    }
}

static void finish_count(GLuint query, GLuint expected_count, const char *name) {
    glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);
    glFlush();
    if (!check("end counter")) return;
    GLuint count = 0xffffffffu;
    if (result(query, &count, name) && count != expected_count) {
        printf("FEEDBACK_WRONG_COUNT case=%s actual=%u expected=%u\n", name, count, expected_count);
        failures++;
    }
    mapped_words(name);
    glDeleteQueries(1, &query);
    (void)check("delete counter");
}

static GLuint begin_count(void) {
    GLuint query = 0;
    glGenQueries(1, &query);
    glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, query);
    if (!query || !check("begin counter")) failures++;
    return query;
}

static void mandatory_admission(void) {
    const GLenum targets[] = {GL_ANY_SAMPLES_PASSED, GL_ANY_SAMPLES_PASSED_CONSERVATIVE,
                              GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN};
    for (unsigned int i = 0; i < 3; i++) {
        GLuint query = 0;
        GLint current = -1;
        glGenQueries(1, &query);
        glGetQueryiv(targets[i], GL_CURRENT_QUERY, &current);
        if (current != 0 || !check("empty CURRENT_QUERY")) failures++;
        glBeginQuery(targets[i], query);
        glGetQueryiv(targets[i], GL_CURRENT_QUERY, &current);
        if (!check("mandatory BEGIN/CURRENT_QUERY") || (GLuint)current != query || !query) failures++;
        glEndQuery(targets[i]);
        glFlush();
        char name[80];
        snprintf(name, sizeof(name), "mandatory/0x%x/empty", targets[i]);
        GLuint value = 2;
        if (!result(query, &value, name) || value != 0) failures++;
        glDeleteQueries(1, &query);
        (void)check("mandatory DELETE");
    }
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGALRM, deadline);
    alarm(120);
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_GBM_KHR, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
    EGLint major = 0, minor = 0;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) || !eglBindAPI(EGL_OPENGL_ES_API)) return 2;
    const EGLint attributes[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, 3, EGL_CONTEXT_MINOR_VERSION_KHR, 0, EGL_NONE};
    EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) return 3;
    const char *renderer = (const char *)glGetString(GL_RENDERER), *version = (const char *)glGetString(GL_VERSION);
    printf("FEEDBACK_RENDERER=%s\nFEEDBACK_VERSION=%s\n", renderer ? renderer : "<null>", version ? version : "<null>");
    if (!renderer || !version || !strstr(renderer, "virgl") || strstr(renderer, "llvmpipe") ||
        strstr(renderer, "softpipe") || !strstr(version, "OpenGL ES 3.0")) return 4;
    GLuint texture = 0, framebuffer = 0, vertices = 0, vao = 0, feedback = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 4, 4);
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE || !check("framebuffer")) return 5;
    GLfloat input[8][4];
    for (unsigned int i = 0; i < 8; i++) for (unsigned int lane = 0; lane < 4; lane++) input[i][lane] = (GLfloat)(i + 1 + lane * 10);
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(1, &vertices);
    glBindBuffer(GL_ARRAY_BUFFER, vertices);
    glBufferData(GL_ARRAY_BUFFER, sizeof(input), input, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 4, GL_FLOAT, GL_FALSE, 16, NULL);
    const char *vs = "#version 300 es\nlayout(location=0) in vec4 p;out vec4 v0;out vec4 v1;void main(){gl_Position=vec4(0,0,0,1);v0=p;v1=p*vec4(2,3,4,5);}\n";
    const char *fs = "#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0,1,0,1);}\n";
    GLuint vertex_shader = compile(GL_VERTEX_SHADER, vs), fragment_shader = compile(GL_FRAGMENT_SHADER, fs), program = glCreateProgram();
    glAttachShader(program, vertex_shader);
    glAttachShader(program, fragment_shader);
    const char *names[] = {"v0", "v1"};
    glTransformFeedbackVaryings(program, 2, names, GL_SEPARATE_ATTRIBS);
    glLinkProgram(program);
    GLint linked = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (!linked || failures || !check("program")) return 6;
    glUseProgram(program);
    glGenBuffers(2, outputs);
    glGenTransformFeedbacks(1, &feedback);
    glBindTransformFeedback(GL_TRANSFORM_FEEDBACK, feedback);
    glEnable(GL_RASTERIZER_DISCARD);
    mandatory_admission();
    const GLenum modes[] = {GL_POINTS, GL_LINE_STRIP, GL_TRIANGLE_STRIP};
    const GLenum categories[] = {GL_POINTS, GL_LINES, GL_TRIANGLES};
    const unsigned int counts[] = {5,4,5}, written[] = {5,6,9}, logical[] = {5,3,3};
    const unsigned int *orders[] = {point_order,line_order,triangle_order};
    const char *labels[] = {"points/two-buffers", "lines/two-buffers", "triangles/two-buffers"};
    for (unsigned int i = 0; i < 3; i++) {
        initialize_outputs();
        GLuint query = begin_count();
        capture_draw(categories[i], modes[i], counts[i], 0, 32, orders[i], written[i]);
        finish_count(query, logical[i], labels[i]);
    }
    initialize_outputs();
    GLuint query = begin_count();
    capture_draw(GL_TRIANGLES, GL_TRIANGLE_STRIP, 5, 0, 32, triangle_order, 9);
    capture_draw(GL_LINES, GL_LINE_STRIP, 4, 9, 23, line_order, 6);
    capture_draw(GL_POINTS, GL_POINTS, 5, 15, 17, point_order, 5);
    finish_count(query, 11, "mixed/two-buffers");
    initialize_outputs();
    query = begin_count();
    capture_draw(GL_TRIANGLES, GL_TRIANGLE_STRIP, 5, 0, 11, triangle_order, 9);
    /* ES3.0.6 section2.15.2: overflow is INVALID_OPERATION, not truncation. */
    for (unsigned int b = 0; b < 2; b++)
        glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER, b, outputs[b], 16 + 9 * 16, 2 * 16);
    glBeginTransformFeedback(GL_LINES);
    if (!check("begin overflow negative")) failures++;
    glDrawArrays(GL_LINE_STRIP, 0, 4);
    GLenum overflow_error = glGetError();
    printf("FEEDBACK_OVERFLOW_REFUSAL error=0x%x expected=0x%x\n", overflow_error, GL_INVALID_OPERATION);
    if (overflow_error != GL_INVALID_OPERATION) failures++;
    glEndTransformFeedback();
    (void)check("end overflow negative");
    /* One complete line is a valid request that fills the remaining range. */
    capture_draw(GL_LINES, GL_LINES, 2, 9, 2, line_order, 2);
    capture_draw(GL_POINTS, GL_POINTS, 5, 11, 0, point_order, 0);
    finish_count(query, 4, "capacity/two-buffers");
    initialize_outputs();
    query = begin_count();
    capture_draw(GL_TRIANGLES, GL_TRIANGLES, 1, 0, 1, triangle_order, 0);
    finish_count(query, 0, "zero/one-incomplete-triangle");
    const GLenum forbidden[] = {0x8914,0x88bf};
    for (unsigned int i = 0; i < 2; i++) {
        GLuint optional = 0;
        glGenQueries(1, &optional);
        glBeginQuery(forbidden[i], optional);
        GLenum error = glGetError();
        printf("FEEDBACK_OPTIONAL_REFUSAL target=0x%x error=0x%x\n", forbidden[i], error);
        if (error != GL_INVALID_ENUM) { failures++; if (error == GL_NO_ERROR) glEndQuery(forbidden[i]); }
        glDeleteQueries(1, &optional);
    }
    glDisable(GL_RASTERIZER_DISCARD);
    glBindTransformFeedback(GL_TRANSFORM_FEEDBACK, 0);
    glDeleteTransformFeedbacks(1, &feedback);
    glDeleteBuffers(2, outputs);
    glDeleteProgram(program);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    glDeleteBuffers(1, &vertices);
    glDeleteVertexArrays(1, &vao);
    glDeleteFramebuffers(1, &framebuffer);
    glDeleteTextures(1, &texture);
    (void)check("cleanup");
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context);
    eglTerminate(display);
    alarm(0);
    printf("FEEDBACK_PROBE_%s failures=%d\n", failures ? "FAIL" : "PASS", failures);
    return failures ? 7 : 0;
}
