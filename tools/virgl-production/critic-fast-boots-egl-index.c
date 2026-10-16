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
typedef void (*get_internal_fn)(unsigned int, unsigned int, unsigned int, int, int *);
typedef void (*generate_objects_fn)(int, unsigned int *);
typedef void (*delete_objects_fn)(int, const unsigned int *);
typedef void (*bind_object_fn)(unsigned int, unsigned int);
typedef void (*storage_multisample_fn)(unsigned int, int, unsigned int, int, int);
typedef void (*renderbuffer_parameter_fn)(unsigned int, unsigned int, int *);
typedef void (*framebuffer_renderbuffer_fn)(unsigned int, unsigned int, unsigned int, unsigned int);
typedef unsigned int (*framebuffer_status_fn)(unsigned int);
typedef void (*draw_buffers_fn)(int, const unsigned int *);
typedef void (*read_buffer_fn)(unsigned int);
typedef void (*clear_buffer_fn)(unsigned int, int, const float *);
typedef void (*blit_framebuffer_fn)(int, int, int, int, int, int, int, int, unsigned int, unsigned int);
typedef void (*read_pixels_fn)(int, int, int, int, unsigned int, unsigned int, void *);

static int mesa_original_multisample_resolve(get_integer_fn get_integer, get_error_fn get_error) {
    generate_objects_fn gen_rb = (generate_objects_fn)eglGetProcAddress("glGenRenderbuffers");
    generate_objects_fn gen_fb = (generate_objects_fn)eglGetProcAddress("glGenFramebuffers");
    delete_objects_fn delete_rb = (delete_objects_fn)eglGetProcAddress("glDeleteRenderbuffers");
    delete_objects_fn delete_fb = (delete_objects_fn)eglGetProcAddress("glDeleteFramebuffers");
    bind_object_fn bind_rb = (bind_object_fn)eglGetProcAddress("glBindRenderbuffer");
    bind_object_fn bind_fb = (bind_object_fn)eglGetProcAddress("glBindFramebuffer");
    storage_multisample_fn storage = (storage_multisample_fn)eglGetProcAddress("glRenderbufferStorageMultisample");
    framebuffer_renderbuffer_fn attach = (framebuffer_renderbuffer_fn)eglGetProcAddress("glFramebufferRenderbuffer");
    framebuffer_status_fn status = (framebuffer_status_fn)eglGetProcAddress("glCheckFramebufferStatus");
    draw_buffers_fn draw_buffers = (draw_buffers_fn)eglGetProcAddress("glDrawBuffers");
    read_buffer_fn read_buffer = (read_buffer_fn)eglGetProcAddress("glReadBuffer");
    clear_buffer_fn clear_buffer = (clear_buffer_fn)eglGetProcAddress("glClearBufferfv");
    blit_framebuffer_fn blit = (blit_framebuffer_fn)eglGetProcAddress("glBlitFramebuffer");
    read_pixels_fn read_pixels = (read_pixels_fn)eglGetProcAddress("glReadPixels");
    if (!gen_rb || !gen_fb || !delete_rb || !delete_fb || !bind_rb || !bind_fb || !storage ||
        !attach || !status || !draw_buffers || !read_buffer || !clear_buffer || !blit || !read_pixels) {
        printf("GL_MESA_ORIGINAL_RESOLVE_ENTRYPOINT_FAIL\n");
        return 0;
    }
    int previous_rb = 0, previous_read = 0, previous_draw = 0;
    get_integer(0x8ca7, &previous_rb); get_integer(0x8caa, &previous_read); get_integer(0x8ca6, &previous_draw);
    unsigned int rb[2] = {0, 0}, fb[2] = {0, 0};
    gen_rb(2, rb); gen_fb(2, fb);
    const unsigned int color_attachment = 0x8ce0;
    bind_rb(0x8d41, rb[0]); storage(0x8d41, 4, 0x8058, 4, 4);
    bind_fb(0x8d40, fb[0]); attach(0x8d40, color_attachment, 0x8d41, rb[0]);
    draw_buffers(1, &color_attachment); read_buffer(color_attachment);
    const unsigned int source_status = status(0x8d40);
    const float green[4] = {0, 1, 0, 1};
    clear_buffer(0x1800, 0, green);
    const unsigned int clear_error = get_error();
    bind_rb(0x8d41, rb[1]); storage(0x8d41, 0, 0x8058, 4, 4);
    bind_fb(0x8ca9, fb[1]); attach(0x8ca9, color_attachment, 0x8d41, rb[1]);
    draw_buffers(1, &color_attachment);
    const unsigned int destination_status = status(0x8ca9);
    /* Mesa emits the actual original BLIT flags, without handcrafted packets.
       There is no active query or conditional-render region in this context. */
    blit(0, 0, 4, 4, 0, 0, 4, 4, 0x4000, 0x2600);
    const unsigned int blit_error = get_error();
    bind_fb(0x8ca8, fb[1]); read_buffer(color_attachment);
    unsigned char pixels[64]; memset(pixels, 0xa5, sizeof(pixels));
    read_pixels(0, 0, 4, 4, 0x1908, 0x1401, pixels);
    const unsigned int read_error = get_error();
    int good_pixels = 0;
    for (unsigned int i = 0; i < 16; ++i)
        if (pixels[i * 4] == 0 && pixels[i * 4 + 1] == 255 &&
            pixels[i * 4 + 2] == 0 && pixels[i * 4 + 3] == 255) ++good_pixels;
    const int pass = rb[0] && rb[1] && fb[0] && fb[1] && source_status == 0x8cd5 &&
        destination_status == 0x8cd5 && clear_error == 0 && blit_error == 0 && read_error == 0 && good_pixels == 16;
    printf("GL_MESA_ORIGINAL_RESOLVE source_status=0x%x destination_status=0x%x clear_error=0x%x blit_error=0x%x read_error=0x%x good_pixels=%d expected_pixels=16 pass=%d\n",
           source_status, destination_status, clear_error, blit_error, read_error, good_pixels, pass);
    printf("GL_MESA_ORIGINAL_RESOLVE_PIXELS=");
    for (unsigned int i = 0; i < sizeof(pixels); ++i) printf("%02x", pixels[i]);
    printf("\n");
    bind_fb(0x8ca8, (unsigned int)previous_read); bind_fb(0x8ca9, (unsigned int)previous_draw);
    bind_rb(0x8d41, (unsigned int)previous_rb); delete_fb(2, fb); delete_rb(2, rb);
    printf("GL_MESA_ORIGINAL_RESOLVE_%s\n", pass ? "PASS" : "FAIL");
    return pass;
}

static int required_multisample_formats(get_integer_fn get_integer, get_error_fn get_error) {
    /* GLES3.0.6 sections3.8.3.1,4.4.2.2,6.1.15: required noninteger
       renderbuffer formats must support the global MAX_SAMPLES value. */
    const struct { const char *name; unsigned int token; } formats[] = {
        {"R8", 0x8229}, {"RG8", 0x822b}, {"RGB8", 0x8051},
        {"RGB565", 0x8d62}, {"RGBA4", 0x8056}, {"RGB5_A1", 0x8057},
        {"RGBA8", 0x8058}, {"SRGB8_ALPHA8", 0x8c43}, {"RGB10_A2", 0x8059},
        {"DEPTH_COMPONENT16", 0x81a5}, {"DEPTH_COMPONENT24", 0x81a6},
        {"DEPTH_COMPONENT32F", 0x8cac}, {"DEPTH24_STENCIL8", 0x88f0},
        {"DEPTH32F_STENCIL8", 0x8cad}, {"STENCIL_INDEX8", 0x8d48},
    };
    get_internal_fn get_internal = (get_internal_fn)eglGetProcAddress("glGetInternalformativ");
    generate_objects_fn generate = (generate_objects_fn)eglGetProcAddress("glGenRenderbuffers");
    delete_objects_fn destroy = (delete_objects_fn)eglGetProcAddress("glDeleteRenderbuffers");
    bind_object_fn bind = (bind_object_fn)eglGetProcAddress("glBindRenderbuffer");
    storage_multisample_fn storage = (storage_multisample_fn)eglGetProcAddress("glRenderbufferStorageMultisample");
    renderbuffer_parameter_fn parameter = (renderbuffer_parameter_fn)eglGetProcAddress("glGetRenderbufferParameteriv");
    if (!get_internal || !generate || !destroy || !bind || !storage || !parameter) {
        printf("GL_REQUIRED_MULTISAMPLE_ENTRYPOINT_FAIL\n");
        return 0;
    }
    int maximum = -1, previous = 0;
    get_integer(0x8d57, &maximum); get_integer(0x8ca7, &previous);
    if (maximum < 4 || maximum > 64 || get_error()) {
        printf("GL_REQUIRED_MULTISAMPLE_MAXIMUM_FAIL maximum=%d\n", maximum);
        return 0;
    }
    int failed = 0;
    for (unsigned int i = 0; i < sizeof(formats) / sizeof(formats[0]); ++i) {
        int count = -1, supported = -1, actual = -1;
        get_internal(0x8d41, formats[i].token, 0x9380, 1, &count);
        unsigned int query_error = get_error();
        get_internal(0x8d41, formats[i].token, 0x80a9, 1, &supported);
        query_error |= get_error();
        unsigned int renderbuffer = 0;
        generate(1, &renderbuffer); bind(0x8d41, renderbuffer);
        storage(0x8d41, maximum, formats[i].token, 2, 2);
        const unsigned int storage_error = get_error();
        parameter(0x8d41, 0x8cab, &actual);
        const unsigned int parameter_error = get_error();
        const int pass = renderbuffer && query_error == 0 && count > 0 && supported >= maximum &&
            storage_error == 0 && parameter_error == 0 && actual >= maximum;
        printf("GL_REQUIRED_MS_FORMAT name=%s counts=%d max_supported=%d requested=%d actual=%d query_error=0x%x storage_error=0x%x parameter_error=0x%x pass=%d\n",
               formats[i].name, count, supported, maximum, actual, query_error, storage_error, parameter_error, pass);
        if (!pass) failed = 1;
        destroy(1, &renderbuffer);
        if (get_error()) failed = 1;
    }
    bind(0x8d41, (unsigned int)previous);
    printf("GL_REQUIRED_MULTISAMPLE_%s\n", failed ? "FAIL" : "PASS");
    return !failed;
}

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
    const int multisample_formats = required_multisample_formats(get_integer, get_error);
    const int mesa_resolve = mesa_original_multisample_resolve(get_integer, get_error);
    const int desktop_rejected = desktop_api_rejected(display);
    const int pass = count > 0 && !denied && error == 0 && numeric && multisample_formats && mesa_resolve && desktop_rejected && renderer &&
        strstr(renderer, "virgl") && !strstr(renderer, "llvmpipe") &&
        !strstr(renderer, "softpipe") && version && strstr(version, "OpenGL ES 3.0");
    printf("EGL_INDEX_%s count=%d forbidden=%d gl_error=0x%x\n", pass ? "PASS" : "FAIL", count, denied, error);
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context); eglTerminate(display);
    return pass ? 0 : 5;
}
