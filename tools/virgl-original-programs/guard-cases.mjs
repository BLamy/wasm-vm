// Literal boundary predictions, independent of the generated implementation.
export const GUARD_CASES=Object.freeze([
 ['positive',0x3f800000,0x40000000,true],
 ['positive-zero-power',0x3f800000,0,true],
 ['positive-negative-power',0x3f000000,0xbf800000,true],
 ['positive-zero',0,0x3f800000,true],
 ['negative-zero',0x80000000,0x3f800000,true],
 ['zero-zero',0,0,false],
 ['zero-negative',0,0xbf800000,false],
 ['negative-base',0xbf800000,0x40000000,false],
 ['subnormal-base',1,0x3f800000,false],
 ['subnormal-exponent',0x3f800000,1,false],
 ['nan-base',0x7fc00000,0x3f800000,false],
 ['nan-exponent',0x3f800000,0x7fc00000,false],
 ['infinite-base',0x7f800000,0x3f800000,false],
 ['infinite-exponent',0x3f800000,0x7f800000,false],
 ['negative-infinity',0xff800000,0x3f800000,false],
 ['upper-margin',0x7b000000,0x3f800000,true], // 2^119
 ['past-upper-margin',0x7b800000,0x3f800000,false],
 ['lower-margin',0x04000000,0x3f800000,true], // 2^-119
 ['past-lower-margin',0x03800000,0x3f800000,false],
 ['mantissa-upper-log',0x7b000001,0x3f800000,false],
 ['envelope-product',0x40000000,0x42ee0000,true], // 2^119
 ['past-envelope-product',0x40000000,0x42f00000,false],
]);
