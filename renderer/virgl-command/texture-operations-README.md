# Original texture operation consumer

`createVirglStandardTextureAsyncRenderer` is an explicit host selection of the retained original 2D/FLOAT image consumer. Use the actual `createVirglStandardTextureShaderBridge` compiler and the selected color resource store's image/uniform/async capabilities. Guest wire commands cannot select this profile.

Original TEX, TXB, TXL, TXF, TXD and TXQ keep their source words, masks and modifiers. Native sampling overloads receive the retained sampler-view channel swizzle. Texture dimensions and query counts keep their integer meaning and receive no color swizzle. Query-only and dead-query bodies permit native compiler elimination.

Every sorted query identity must match an original stage sampler declaration. Native active queries reflect scalar INT/count one. Their uniform components count toward the original stage budget. At a draw, each level count comes from the captured image range's owned local plane count, including a private nonzero-base view. A public resource ID replacement cannot supply it. Programs may link before views exist; draw validation supplies the retained authority.

The compiler, image ownership and format evidence carry from their verified predecessors. This selected consumer grants no production capset, guest API negotiation or deployment. The production browser GPU worker and actual guest Mesa/compositor require their own recorded qualification.

Use `createStandardTextureTransferBackend` with the existing original color resource owner. This explicit selection preserves raw buffer readbacks for index/generic attributes and uses the same original native color-image conversions. The historical transfer factory keeps its original selection.
