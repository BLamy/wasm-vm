// SPDX-License-Identifier: MIT
#include <QSurfaceFormat>
#include <cstdio>

// The browser guest implements GLES 3.0. Select that client API before Qt
// constructs its application/windows; Qt's Linux desktop-GL build otherwise
// asks for EGL_OPENGL_BIT even when its rendering context falls back to GLES.
// This changes no EGL/GL capabilities, return values, shaders or pixel data.
__attribute__((constructor)) static void select_browser_gles_format() {
    QSurfaceFormat format = QSurfaceFormat::defaultFormat();
    format.setRenderableType(QSurfaceFormat::OpenGLES);
    format.setVersion(3, 0);
    format.setProfile(QSurfaceFormat::NoProfile);
    QSurfaceFormat::setDefaultFormat(format);
    std::fprintf(stderr, "QUICKSHELL_BROWSER_FORMAT OpenGLES 3.0\n");
}
