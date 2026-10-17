/** Pinned original byte-color layouts; selected only by the color host factories. */
export const STANDARD_COLOR_TRANSFER_PROFILE = "virgl-standard-byte-color-transfers-v1";
const formats = Object.freeze(Object.fromEntries([
  [1,"B8G8R8A8_UNORM",4,4,"RGBA8","RGBA","UNSIGNED_BYTE",[2,1,0,3],false,false,false],
  [3,"A8R8G8B8_UNORM",4,4,"RGBA8","RGBA","UNSIGNED_BYTE",[1,2,3,0],false,false,false],
  [4,"X8R8G8B8_UNORM",4,3,"RGB8","RGB","UNSIGNED_BYTE",[1,2,3,"1"],true,false,false],
  [64,"R8_UNORM",1,1,"R8","RED","UNSIGNED_BYTE",[0,"0","0","1"],true,false,false],
  [65,"R8G8_UNORM",2,2,"RG8","RG","UNSIGNED_BYTE",[0,1,"0","1"],true,false,false],
  [66,"R8G8B8_UNORM",3,3,"RGB8","RGB","UNSIGNED_BYTE",[0,1,2,"1"],true,false,false],
  [68,"X8B8G8R8_UNORM",4,3,"RGB8","RGB","UNSIGNED_BYTE",[3,2,1,"1"],true,false,false],
  [74,"R8_SNORM",1,1,"R8_SNORM","RED","BYTE",[0,"0","0","1"],true,true,false],
  [75,"R8G8_SNORM",2,2,"RG8_SNORM","RG","BYTE",[0,1,"0","1"],true,true,false],
  [76,"R8G8B8_SNORM",3,4,"RGBA8_SNORM","RGBA","BYTE",[0,1,2,"1"],true,true,false],
  [77,"R8G8B8A8_SNORM",4,4,"RGBA8_SNORM","RGBA","BYTE",[0,1,2,3],false,true,false],
  [97,"R8G8B8_SRGB",3,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[0,1,2,"1"],true,false,true],
  [98,"A8B8G8R8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[3,2,1,0],false,false,true],
  [99,"X8B8G8R8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[3,2,1,"1"],true,false,true],
  [100,"B8G8R8A8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[2,1,0,3],false,false,true],
  [101,"B8G8R8X8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[2,1,0,"1"],true,false,true],
  [102,"A8R8G8B8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[1,2,3,0],false,false,true],
  [103,"X8R8G8B8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[1,2,3,"1"],true,false,true],
  [104,"R8G8B8A8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[0,1,2,3],false,false,true],
  [121,"A8B8G8R8_UNORM",4,4,"RGBA8","RGBA","UNSIGNED_BYTE",[3,2,1,0],false,false,false],
  [134,"R8G8B8X8_UNORM",4,3,"RGB8","RGB","UNSIGNED_BYTE",[0,1,2,"1"],true,false,false],
  [230,"R8G8B8X8_SRGB",4,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[0,1,2,"1"],true,false,true],
  [317,"B8G8R8_UNORM",3,3,"RGB8","RGB","UNSIGNED_BYTE",[2,1,0,"1"],true,false,false],
  [387,"B8G8R8_SRGB",3,4,"SRGB8_ALPHA8","RGBA","UNSIGNED_BYTE",[2,1,0,"1"],true,false,true]
].map(([format, name, pixelBytes, nativePixelBytes, internal, upload, type, lanes, implicitAlpha, snorm, srgb]) =>
  [format, Object.freeze({ format, name, pixelBytes, nativePixelBytes, internal, upload, type,
    lanes: Object.freeze(lanes), implicitAlpha, snorm, srgb, render: !snorm })])));
export const byteColorFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;
