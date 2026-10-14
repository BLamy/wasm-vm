/* Independent guest-side ES3 identity and indexed optional-extension probe. */
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <stdio.h>
#include <string.h>

typedef const unsigned char *(*get_string_fn)(unsigned int);
typedef const unsigned char *(*get_string_i_fn)(unsigned int, unsigned int);
typedef void (*get_integer_fn)(unsigned int, int *);
typedef unsigned int (*get_error_fn)(void);
typedef void (*get_integer64_fn)(unsigned int, long long *);

static int core_numeric_floors(get_integer_fn get_integer, get_error_fn get_error) {
    /* Khronos GLES 3.0.6 tables 6.28, 6.31-6.35; no version-string inference. */
    const struct { const char *name; unsigned int token; int floor; int ceiling; } limits[] = {
        {"MAX_TEXTURE_SIZE", 0x0d33, 2048, 0},
        {"MAX_3D_TEXTURE_SIZE", 0x8073, 256, 0},
        {"MAX_CUBE_MAP_TEXTURE_SIZE", 0x851c, 2048, 0},
        {"MAX_ARRAY_TEXTURE_LAYERS", 0x88ff, 256, 0},
        {"MAX_RENDERBUFFER_SIZE", 0x84e8, 2048, 0},
        {"MAX_DRAW_BUFFERS", 0x8824, 4, 0},
        {"MAX_COLOR_ATTACHMENTS", 0x8cdf, 4, 0},
        {"MAX_VERTEX_ATTRIBS", 0x8869, 16, 0},
        {"MAX_VERTEX_UNIFORM_COMPONENTS", 0x8b4a, 1024, 0},
        {"MAX_VERTEX_UNIFORM_VECTORS", 0x8dfb, 256, 0},
        {"MAX_FRAGMENT_UNIFORM_COMPONENTS", 0x8b49, 896, 0},
        {"MAX_FRAGMENT_UNIFORM_VECTORS", 0x8dfd, 224, 0},
        {"MAX_VERTEX_UNIFORM_BLOCKS", 0x8a2b, 12, 0},
        {"MAX_FRAGMENT_UNIFORM_BLOCKS", 0x8a2d, 12, 0},
        {"MAX_UNIFORM_BUFFER_BINDINGS", 0x8a2f, 24, 0},
        {"MAX_COMBINED_UNIFORM_BLOCKS", 0x8a2e, 24, 0},
        {"UNIFORM_BUFFER_OFFSET_ALIGNMENT", 0x8a34, 1, 256},
        {"MAX_VERTEX_OUTPUT_COMPONENTS", 0x9122, 64, 0},
        {"MAX_FRAGMENT_INPUT_COMPONENTS", 0x9125, 60, 0},
        {"MAX_VARYING_COMPONENTS", 0x8b4b, 60, 0},
        {"MAX_VARYING_VECTORS", 0x8dfc, 15, 0},
        {"MAX_VERTEX_TEXTURE_IMAGE_UNITS", 0x8b4c, 16, 0},
        {"MAX_TEXTURE_IMAGE_UNITS", 0x8872, 16, 0},
        {"MAX_COMBINED_TEXTURE_IMAGE_UNITS", 0x8b4d, 32, 0},
        {"MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS", 0x8c8a, 64, 0},
        {"MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS", 0x8c8b, 4, 0},
        {"MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS", 0x8c80, 4, 0},
        {"MAX_SAMPLES", 0x8d57, 4, 0},
    };
    int failed = 0;
    for (unsigned int i = 0; i < sizeof(limits) / sizeof(limits[0]); ++i) {
        int value = -1;
        get_integer(limits[i].token, &value);
        const unsigned int error = get_error();
        const int pass = error == 0 && value >= limits[i].floor &&
            (!limits[i].ceiling || value <= limits[i].ceiling);
        printf("GL_CORE_LIMIT name=%s value=%d floor=%d ceiling=%d gl_error=0x%x pass=%d\n",
               limits[i].name, value, limits[i].floor, limits[i].ceiling, error, pass);
        if (!pass) failed = 1;
    }
    get_integer64_fn get_integer64 = (get_integer64_fn)eglGetProcAddress("glGetInteger64v");
    long long block_size = -1;
    if (get_integer64) get_integer64(0x8a30, &block_size);
    const unsigned int error = get_error();
    const int pass = get_integer64 && error == 0 && block_size >= 16384;
    printf("GL_CORE_LIMIT name=MAX_UNIFORM_BLOCK_SIZE value=%lld floor=16384 gl_error=0x%x pass=%d\n",
           block_size, error, pass);
    if (!pass) failed = 1;
    printf("GL_CORE_NUMERIC_%s\n", failed ? "FAIL" : "PASS");
    return !failed;
}

static int forbidden(const char *name) {
    return !strcmp(name, "GL_EXT_texture_border_clamp") ||
           !strcmp(name, "GL_OES_texture_border_clamp") ||
           !strcmp(name, "GL_EXT_texture_sRGB_decode");
}

static int legacy_forbidden(const char *list) {
    if (!list) return 1;
    const char *names[] = {"GL_EXT_texture_border_clamp", "GL_OES_texture_border_clamp",
                           "GL_EXT_texture_sRGB_decode"};
    for (unsigned int i = 0; i < sizeof(names) / sizeof(names[0]); ++i) {
        const char *position = list;
        while ((position = strstr(position, names[i]))) {
            const size_t length = strlen(names[i]);
            if ((position == list || position[-1] == ' ') &&
                (position[length] == '\0' || position[length] == ' ')) return 1;
            position += length;
        }
    }
    return 0;
}

static int desktop_api_rejected(EGLDisplay display) {
    const char *apis = eglQueryString(display, EGL_CLIENT_APIS);
    int failed = !apis;
    if (apis) {
        const char *start = apis;
        while (*start == ' ') ++start;
        const size_t length = strcspn(start, " ");
        const char *end = start + length;
        while (*end == ' ') ++end;
        failed = length != strlen("OpenGL_ES") ||
            strncmp(start, "OpenGL_ES", length) || *end;
    }
    printf("EGL_CLIENT_APIS=%s\n", apis ? apis : "<null>");

    const EGLint choose[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE};
    EGLint matches = -1;
    const EGLBoolean selected = eglChooseConfig(display, choose, NULL, 0, &matches);
    const EGLint choose_error = eglGetError();
    printf("DESKTOP_GL_CONFIGS selected=%u count=%d egl_error=0x%x\n",
           selected, matches, choose_error);
    if (!selected || choose_error != EGL_SUCCESS || matches != 0) failed = 1;

    EGLConfig configs[2048];
    EGLint count = 0;
    EGLConfig es_config = NULL;
    if (!eglGetConfigs(display, configs, 2048, &count) || count <= 0 || count > 2048) {
        failed = 1;
    } else {
        for (EGLint i = 0; i < count; ++i) {
            EGLint mask = 0;
            if (!eglGetConfigAttrib(display, configs[i], EGL_RENDERABLE_TYPE, &mask)) failed = 1;
            if (mask & (EGL_OPENGL_BIT | EGL_OPENVG_BIT)) failed = 1;
            if (!es_config && (mask & EGL_OPENGL_ES3_BIT_KHR)) es_config = configs[i];
        }
    }
    printf("EGL_CONFIG_API_SCAN count=%d forbidden=%d es3_config=%u egl_error=0x%x\n",
           count, failed, es_config != NULL, eglGetError());
    if (!es_config) failed = 1;

    const EGLBoolean bound = eglBindAPI(EGL_OPENGL_API);
    const EGLint bind_error = eglGetError();
    printf("DESKTOP_GL_BIND selected=%u egl_error=0x%x\n", bound, bind_error);
    if (bound) {
        const EGLint versions[][2] = {{1, 0}, {3, 0}, {3, 1}, {3, 3}};
        for (unsigned int i = 0; i < sizeof(versions) / sizeof(versions[0]); ++i) {
            const EGLint attrs[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, versions[i][0],
                                    EGL_CONTEXT_MINOR_VERSION_KHR, versions[i][1], EGL_NONE};
            for (unsigned int no_config = 0; no_config < 2; ++no_config) {
                EGLContext context = eglCreateContext(display,
                    no_config ? EGL_NO_CONFIG_KHR : es_config, EGL_NO_CONTEXT, attrs);
                const EGLint error = eglGetError();
                const int rejected = context == EGL_NO_CONTEXT &&
                    (error == EGL_BAD_MATCH || error == EGL_BAD_CONFIG || error == EGL_BAD_ATTRIBUTE);
                printf("DESKTOP_GL_CONTEXT version=%d.%d no_config=%u rejected=%d egl_error=0x%x\n",
                       versions[i][0], versions[i][1], no_config, rejected, error);
                if (!rejected) failed = 1;
                if (context != EGL_NO_CONTEXT) eglDestroyContext(display, context);
            }
        }
        EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, NULL);
        const EGLint error = eglGetError();
        const int rejected = context == EGL_NO_CONTEXT && (error == EGL_BAD_MATCH || error == EGL_BAD_CONFIG);
        printf("DESKTOP_GL_CONTEXT default_attributes=1 no_config=1 rejected=%d egl_error=0x%x\n", rejected, error);
        if (!rejected) failed = 1;
        if (context != EGL_NO_CONTEXT) eglDestroyContext(display, context);
    } else if (bind_error != EGL_BAD_PARAMETER) {
        failed = 1;
    }
    if (!eglBindAPI(EGL_OPENGL_ES_API)) failed = 1;
    printf("EGL_PUBLIC_GLES_ONLY_%s\n", failed ? "FAIL" : "PASS");
    return !failed;
}

int main(void) {
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_GBM_KHR, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
    EGLint major = 0, minor = 0;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) ||
        !eglBindAPI(EGL_OPENGL_ES_API)) {
        printf("EGL_INDEX_INIT_FAIL error=0x%x\n", eglGetError());
        return 2;
    }
    const EGLint attributes[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, 3,
                                 EGL_CONTEXT_MINOR_VERSION_KHR, 0, EGL_NONE};
    EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) {
        printf("EGL_INDEX_CONTEXT_FAIL error=0x%x\n", eglGetError());
        return 3;
    }
    get_string_fn get_string = (get_string_fn)eglGetProcAddress("glGetString");
    get_string_i_fn get_string_i = (get_string_i_fn)eglGetProcAddress("glGetStringi");
    get_integer_fn get_integer = (get_integer_fn)eglGetProcAddress("glGetIntegerv");
    get_error_fn get_error = (get_error_fn)eglGetProcAddress("glGetError");
    if (!get_string || !get_string_i || !get_integer || !get_error) return 4;
    const char *renderer = (const char *)get_string(0x1f01);
    const char *version = (const char *)get_string(0x1f02);
    const char *legacy = (const char *)get_string(0x1f03);
    printf("EGL_VERSION=%d.%d\nGL_RENDERER=%s\nGL_VERSION=%s\n", major, minor,
           renderer ? renderer : "<null>", version ? version : "<null>");
    printf("GL_LEGACY_EXTENSIONS=%s\n", legacy ? legacy : "<null>");
    int count = 0, denied = legacy_forbidden(legacy);
    get_integer(0x821d, &count); /* GL_NUM_EXTENSIONS */
    printf("GL_NUM_EXTENSIONS=%d\nGL_INDEXED_EXTENSIONS_BEGIN\n", count);
    if (count <= 0 || count > 2048) denied = 1;
    for (int i = 0; count <= 2048 && i < count; ++i) {
        const char *name = (const char *)get_string_i(0x1f03, (unsigned int)i);
        if (!name) { denied = 1; printf("NULL_EXTENSION index=%d\n", i); continue; }
        printf("GL_INDEXED_EXTENSION[%d]=%s\n", i, name);
        if (forbidden(name)) denied = 1;
    }
    printf("GL_INDEXED_EXTENSIONS_END\n");
    const unsigned int error = get_error();
    const int numeric = core_numeric_floors(get_integer, get_error);
    const int desktop_rejected = desktop_api_rejected(display);
    const int pass = count > 0 && !denied && error == 0 && numeric && desktop_rejected && renderer &&
        strstr(renderer, "virgl") && !strstr(renderer, "llvmpipe") &&
        !strstr(renderer, "softpipe") && version && strstr(version, "OpenGL ES 3.0");
    printf("EGL_INDEX_%s count=%d forbidden=%d gl_error=0x%x\n", pass ? "PASS" : "FAIL", count, denied, error);
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context); eglTerminate(display);
    return pass ? 0 : 5;
}
