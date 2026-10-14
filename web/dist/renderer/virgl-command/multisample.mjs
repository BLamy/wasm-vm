/** Original 2D framebuffer copies and native multisample resolves. */
export function qualifyMultisampleStorage(gl) {
  if (gl.getParameter(gl.MAX_SAMPLES) < 4) throw Error('Four native samples are required by GLES 3.0');
  const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    oldRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST),
    mask = gl.getParameter(gl.COLOR_WRITEMASK);
  let source = null, destination = null, color = null, depth = null, resolved = null;
  try {
    source = gl.createFramebuffer();destination = gl.createFramebuffer();color = gl.createRenderbuffer();
    depth = gl.createRenderbuffer();resolved = gl.createRenderbuffer();
    if (![source,destination,color,depth,resolved].every(Boolean)) throw Error('Multisample qualification allocation failed');
    for (const [buffer,format,samples] of [[color,gl.RGBA8,4],[depth,gl.DEPTH24_STENCIL8,4],[resolved,gl.RGBA8,0]]) {
      gl.bindRenderbuffer(gl.RENDERBUFFER,buffer);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,format,2,2);
      if (gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_SAMPLES) !== samples) throw Error('Native sample count disagrees');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,source);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Four-sample color/depth qualification is incomplete');
    gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,1,0,1]));gl.clearBufferfi(gl.DEPTH_STENCIL,0,0.5,7);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,destination);gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,resolved);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.blitFramebuffer(0,0,2,2,0,0,2,2,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,destination);gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const pixels = new Uint8Array(16);gl.readPixels(0,0,2,2,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if (pixels.some((value,index) => value !== (index % 4 === 1 || index % 4 === 3 ? 255 : 0)) || gl.getError() !== gl.NO_ERROR)
      throw Error('Four-sample native resolve produced incorrect pixels');
    return {samples:4,color:'RGBA8',depth:'DEPTH24_STENCIL8',resolvedPixels:[...pixels]};
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);
    gl.bindRenderbuffer(gl.RENDERBUFFER,oldRenderbuffer);gl.colorMask(...mask);gl[scissor?'enable':'disable'](gl.SCISSOR_TEST);
    for (const buffer of [color,depth,resolved]) if (buffer) gl.deleteRenderbuffer(buffer);
    for (const buffer of [source,destination]) if (buffer) gl.deleteFramebuffer(buffer);
  }
}

export function executeFramebufferBlit(gl, fields, source, destination, require, check) {
  const a = source.metadata, b = destination.metadata;
  require(a.target === 2 && b.target === 2 && a.id !== b.id,
    'unsupported-blit', 'BLIT requires distinct owned 2D attachments.');
  require(fields.source.format === a.format && fields.destination.format === b.format && a.format === b.format,
    'unsupported-blit', 'BLIT cannot reinterpret the original storage format.');
  const validate = (box, meta) => {
    require(box.level <= meta.lastLevel && box.z === 0 && box.depth === 1,
      'out-of-bounds', 'BLIT selects an invalid level or layer.');
    for (const [origin, extent, bound] of [[box.x, box.width, Math.max(1, Math.floor(meta.width / 2 ** box.level))],
      [box.y, box.height, Math.max(1, Math.floor(meta.height / 2 ** box.level))]]) {
      require(extent !== 0 && origin >= 0 && origin <= bound && origin + extent >= 0 && origin + extent <= bound,
        'out-of-bounds', 'Signed BLIT rectangle exceeds its original attachment.');
    }
  };
  validate(fields.source, a); validate(fields.destination, b);
  require(b.nrSamples === 0, 'unsupported-blit', 'GLES BLIT requires a single-sample destination.');
  if (a.nrSamples) require(fields.filter === 0 &&
    ['x','y','width','height'].every(key => fields.source[key] === fields.destination[key]),
    'unsupported-blit', 'Native multisample resolve requires identical nearest rectangles.');
  const depth = (a.bind & 1) !== 0;
  require(depth ? !(fields.mask & 15) : fields.mask === 15,
    'unsupported-blit', 'BLIT mask contradicts its original attachment role.');
  require(!depth || fields.filter === 0, 'unsupported-blit', 'Depth and stencil require nearest copies.');
  require(!(fields.mask & 32) || [20,126].includes(a.format),
    'unsupported-blit', 'Stencil BLIT requires combined depth/stencil storage.');
  const attachment = depth ? fields.mask & 32 ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0;
  const mask = (fields.mask & 15 ? gl.COLOR_BUFFER_BIT : 0) |
    (fields.mask & 16 ? gl.DEPTH_BUFFER_BIT : 0) | (fields.mask & 32 ? gl.STENCIL_BUFFER_BIT : 0);
  const previous = {read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    scissor:gl.isEnabled(gl.SCISSOR_TEST),box:gl.getParameter(gl.SCISSOR_BOX)};
  let read = null, draw = null;
  const attachRead = (entry, box) => {
    if (entry.storage.renderbuffer) gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, attachment, gl.RENDERBUFFER, entry.storage.renderbuffer);
    else gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, attachment, gl.TEXTURE_2D, entry.storage.texture, box.level);
  };
  try {
    read = gl.createFramebuffer(); draw = gl.createFramebuffer();
    require(read && draw, 'backend-error', 'BLIT framebuffer allocation failed.');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read); attachRead(source, fields.source);
    gl.readBuffer(depth ? gl.NONE : gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, destination.storage.texture, fields.destination.level);
    gl.drawBuffers([depth ? gl.NONE : gl.COLOR_ATTACHMENT0]);
    require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE &&
      gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
      'incomplete-framebuffer', 'Original BLIT attachment is incomplete.');
    if (fields.scissor) {
      gl.enable(gl.SCISSOR_TEST); const {minX,minY,maxX,maxY} = fields.scissor;
      gl.scissor(minX,minY,maxX-minX,maxY-minY);
    } else gl.disable(gl.SCISSOR_TEST);
    const s = fields.source, d = fields.destination;
    gl.blitFramebuffer(s.x,s.y,s.x+s.width,s.y+s.height,d.x,d.y,d.x+d.width,d.y+d.height,
      mask,fields.filter ? gl.LINEAR : gl.NEAREST); check();
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous.read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,previous.draw);
    gl.scissor(...previous.box);gl[previous.scissor?'enable':'disable'](gl.SCISSOR_TEST);
    if (read) gl.deleteFramebuffer(read);if (draw) gl.deleteFramebuffer(draw);
  }
}
