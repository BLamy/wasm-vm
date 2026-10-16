/** Original unsigned shared exponent image, selected only by its owner. */
export const STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE = 'virgl-standard-rgb9e5-transfers-v1';
const format = Object.freeze({format:125,name:'R9G9B9E5_FLOAT',components:3,pixelBytes:4,nativePixelBytes:4,readPixelBytes:4,conversionPixelBytes:4,copyPixelBytes:8,upload:'RGB',type:'UNSIGNED_INT_5_9_9_9_REV',lanes:Object.freeze([0,1,2,'1']),implicitAlpha:true,render:false,internal:'RGB9_E5',sharedExponent:true});
export const sharedExponentColorFormat = id => id === 125 ? format : null;
