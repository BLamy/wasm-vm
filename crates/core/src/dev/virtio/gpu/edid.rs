//! Deterministic EDID 1.4 generation for the virtio-gpu display.
//!
//! The generator deliberately emits one preferred detailed timing descriptor and keeps all
//! arithmetic widened until the final EDID wire fields are encoded.  That makes the bytes stable
//! on native and wasm32 while still allowing the host to change the active mode at a run boundary.

/// The size of an EDID base block.
pub const EDID_BLOCK_SIZE: usize = 128;
/// The largest active dimension representable by an EDID detailed timing descriptor.
pub const MAX_EDID_DIMENSION: u32 = 4095;
/// The default refresh rate used by the single virtual scanout.
pub const DEFAULT_REFRESH_HZ: u32 = 60;

const MAX_PIXEL_CLOCK_10KHZ: u64 = 65_535;

/// Generate an EDID 1.4 base block for one progressive digital display mode.
///
/// EDID stores active dimensions and blanking in twelve bits and pixel clock in a sixteen-bit
/// count of 10 kHz units.  Inputs outside those wire limits are clamped to the closest
/// representable value; [`super::VirtioGpu::set_display`] applies the same policy to the mode
/// advertised through GET_DISPLAY_INFO.  Valid canvas dimensions (including odd widths) therefore
/// round-trip exactly in the preferred timing.
pub fn edid_for(width: u32, height: u32, refresh: u32) -> [u8; EDID_BLOCK_SIZE] {
    let width = width.clamp(1, MAX_EDID_DIMENSION);
    let height = height.clamp(1, MAX_EDID_DIMENSION);
    let refresh = refresh.clamp(1, 255);

    // A reduced-blanking-shaped timing keeps the virtual monitor's pixel clock modest while
    // leaving enough porch/sync space for every normal desktop size through 3840x2160.
    let hblank = horizontal_blanking(width);
    let vblank = vertical_blanking(height);
    let htotal = u64::from(width) + u64::from(hblank);
    let vtotal = u64::from(height) + u64::from(vblank);
    let pixel_clock_10khz = ((htotal * vtotal * u64::from(refresh)) + 5_000) / 10_000;
    let pixel_clock_10khz = pixel_clock_10khz.clamp(1, MAX_PIXEL_CLOCK_10KHZ) as u16;

    let hsync_offset = (hblank / 4).max(8);
    let hsync_width = (hblank / 8).max(8);
    let vsync_offset = (vblank / 4).max(1);
    let vsync_width = (vblank / 8).max(3);
    let hsize_cm = physical_size_cm(width);
    let vsize_cm = physical_size_cm(height);

    let mut edid = [0u8; EDID_BLOCK_SIZE];
    edid[0..8].copy_from_slice(&[0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
    // PNP ID "WVM" (the wasm-vm virtual monitor), big-endian as required by EDID.
    edid[8..10].copy_from_slice(&0x5ecdu16.to_be_bytes());
    edid[10..12].copy_from_slice(&1u16.to_le_bytes());
    edid[12..16].copy_from_slice(&1u32.to_le_bytes());
    edid[16] = 1; // week 1; fixed so regeneration remains byte-identical.
    edid[17] = 30; // 2020, the stable virtual monitor model year.
    edid[18] = 1; // EDID version 1.
    edid[19] = 4; // EDID revision 1.4.
    edid[20] = 0xa5; // digital, 8 bpc, DisplayPort interface code.
    edid[21] = hsize_cm;
    edid[22] = vsize_cm;
    edid[23] = 120; // gamma 2.20: (120 + 100) / 100.
    edid[24] = 0x0a; // sRGB color space + preferred timing present.
    write_srgb_chromaticity(&mut edid[25..35]);

    // Keep the standard-timing slots explicitly unused.  The preferred DTD below is the source
    // of truth; virtio-gpu's GET_DISPLAY_INFO continues to provide its stock mode list.
    for pair in edid[38..54].chunks_exact_mut(2) {
        pair.copy_from_slice(&[0x01, 0x01]);
    }

    write_detailed_timing(
        &mut edid[54..72],
        width,
        height,
        hblank,
        vblank,
        pixel_clock_10khz,
        hsync_offset,
        hsync_width,
        vsync_offset,
        vsync_width,
        hsize_cm,
        vsize_cm,
    );
    write_descriptor(
        &mut edid[72..90],
        0xfd,
        &[
            30, 120, 15, 250, 60, 1, 10, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
        ],
    );
    write_descriptor(&mut edid[90..108], 0xfc, b"WASM VM\n    ");
    write_descriptor(&mut edid[108..126], 0xff, b"WVM-0001\n    ");
    edid[126] = 0; // no extension blocks
    edid[127] = checksum(&edid[..127]);
    edid
}

/// Return the checksum byte that makes the sum of an EDID block congruent to zero.
pub const fn checksum(bytes: &[u8]) -> u8 {
    let mut sum = 0u8;
    let mut index = 0;
    while index < bytes.len() {
        sum = sum.wrapping_add(bytes[index]);
        index += 1;
    }
    0u8.wrapping_sub(sum)
}

fn horizontal_blanking(width: u32) -> u16 {
    let scaled = (width / 8).max(160);
    // Keep the blanking even, as common reduced-blanking timings do.  The active width itself is
    // intentionally left untouched so odd canvas widths remain visible in the DTD.
    scaled.saturating_add(scaled & 1).min(u32::from(u16::MAX)) as u16
}

fn vertical_blanking(height: u32) -> u16 {
    let scaled = (height / 32).max(30);
    scaled.saturating_add(scaled & 1).min(u32::from(u16::MAX)) as u16
}

fn physical_size_cm(pixels: u32) -> u8 {
    // A stable 96-DPI virtual panel scale: cm = pixels * 2.54 / 96, rounded to nearest cm.
    ((u64::from(pixels) * 127 + 2_400) / 4_800).clamp(1, 255) as u8
}

fn write_srgb_chromaticity(out: &mut [u8]) {
    debug_assert_eq!(out.len(), 10);
    // 10-bit EDID coordinates: R(0.640,0.330), G(0.300,0.600), B(0.150,0.060),
    // white point (0.313,0.329).  Keeping the common sRGB values avoids an undefined-color
    // warning in real EDID consumers while requiring no floating point in the core crate.
    let x = [655u16, 307, 154, 320];
    let y = [338u16, 614, 61, 337];
    out[0] = ((x[0] >> 8) as u8) << 6
        | ((y[0] >> 8) as u8) << 4
        | ((x[1] >> 8) as u8) << 2
        | (y[1] >> 8) as u8;
    out[1] = ((x[2] >> 8) as u8) << 6
        | ((y[2] >> 8) as u8) << 4
        | ((x[3] >> 8) as u8) << 2
        | (y[3] >> 8) as u8;
    out[2..10].copy_from_slice(&[
        (x[0] >> 2) as u8,
        (y[0] >> 2) as u8,
        (x[1] >> 2) as u8,
        (y[1] >> 2) as u8,
        (x[2] >> 2) as u8,
        (y[2] >> 2) as u8,
        (x[3] >> 2) as u8,
        (y[3] >> 2) as u8,
    ]);
}

#[allow(clippy::too_many_arguments)]
fn write_detailed_timing(
    out: &mut [u8],
    width: u32,
    height: u32,
    hblank: u16,
    vblank: u16,
    pixel_clock_10khz: u16,
    hsync_offset: u16,
    hsync_width: u16,
    vsync_offset: u16,
    vsync_width: u16,
    hsize_cm: u8,
    vsize_cm: u8,
) {
    debug_assert_eq!(out.len(), 18);
    out.fill(0);
    out[0..2].copy_from_slice(&pixel_clock_10khz.to_le_bytes());
    out[2] = width as u8;
    out[3] = hblank as u8;
    out[4] = ((width >> 8) as u8) << 4 | (hblank >> 8) as u8;
    out[5] = height as u8;
    out[6] = vblank as u8;
    out[7] = ((height >> 8) as u8) << 4 | (vblank >> 8) as u8;
    out[8] = hsync_offset as u8;
    out[9] = hsync_width as u8;
    out[10] = ((vsync_offset as u8) & 0x0f) << 4 | (vsync_width as u8) & 0x0f;
    out[11] = (((hsync_offset >> 8) as u8) & 0x03) << 6
        | (((hsync_width >> 8) as u8) & 0x03) << 4
        | (((vsync_offset >> 4) as u8) & 0x03) << 2
        | ((vsync_width >> 4) as u8) & 0x03;
    let hsize_mm = u16::from(hsize_cm) * 10;
    let vsize_mm = u16::from(vsize_cm) * 10;
    out[12] = hsize_mm as u8;
    out[13] = vsize_mm as u8;
    out[14] = ((hsize_mm >> 8) as u8) << 4 | (vsize_mm >> 8) as u8;
    out[17] = 0x1a; // non-interlaced, digital separate sync, positive polarities.
}

fn write_descriptor(out: &mut [u8], tag: u8, payload: &[u8]) {
    debug_assert_eq!(out.len(), 18);
    debug_assert!(payload.len() <= 13);
    out.fill(0);
    out[3] = tag;
    let copy_len = payload.len().min(13);
    out[5..5 + copy_len].copy_from_slice(&payload[..copy_len]);
    for byte in &mut out[5 + copy_len..18] {
        if *byte == 0 {
            *byte = b' ';
        }
    }
    if tag == 0xfc || tag == 0xff {
        // Text descriptors must terminate in a newline; the caller's payload includes one.
        debug_assert!(payload.contains(&b'\n'));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDID_1280X800_60: [u8; EDID_BLOCK_SIZE] = [
        0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x5e, 0xcd, 0x01, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x01, 0x1e, 0x01, 0x04, 0xa5, 0x22, 0x15, 0x78, 0x0a, 0x96, 0x05, 0xa3, 0x54, 0x4c,
        0x99, 0x26, 0x0f, 0x50, 0x54, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x03, 0x1c, 0x00, 0xa0, 0x50, 0x20,
        0x1e, 0x30, 0x28, 0x14, 0x73, 0x00, 0x54, 0xd2, 0x10, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
        0xfd, 0x00, 0x1e, 0x78, 0x0f, 0xfa, 0x3c, 0x01, 0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
        0x00, 0x00, 0x00, 0xfc, 0x00, 0x57, 0x41, 0x53, 0x4d, 0x20, 0x56, 0x4d, 0x0a, 0x20, 0x20,
        0x20, 0x20, 0x20, 0x00, 0x00, 0x00, 0xff, 0x00, 0x57, 0x56, 0x4d, 0x2d, 0x30, 0x30, 0x30,
        0x31, 0x0a, 0x20, 0x20, 0x20, 0x20, 0x00, 0xc6,
    ];

    fn dtd_active(block: &[u8; EDID_BLOCK_SIZE]) -> (u32, u32) {
        let hactive = u32::from(block[2 + 54]) | u32::from(block[4 + 54] & 0xf0) << 4;
        let vactive = u32::from(block[5 + 54]) | u32::from(block[7 + 54] & 0xf0) << 4;
        (hactive, vactive)
    }

    #[test]
    fn fixture_and_checksum_are_stable() {
        let block = edid_for(1280, 800, 60);
        assert_eq!(block, EDID_1280X800_60);
        assert_eq!(
            block.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
            0
        );
        assert_eq!(dtd_active(&block), (1280, 800));
        assert_eq!(
            &block[..8],
            &[0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]
        );
        assert_eq!(&block[8..10], &0x5ecdu16.to_be_bytes());
        assert_eq!(&block[18..20], &[1, 4]);
    }

    #[test]
    fn checksum_and_preferred_mode_cover_odd_and_large_sizes() {
        let sizes = [
            (640, 480),
            (641, 480),
            (800, 600),
            (801, 600),
            (1023, 768),
            (1024, 769),
            (1152, 864),
            (1280, 720),
            (1281, 721),
            (1280, 800),
            (1365, 768),
            (1366, 769),
            (1440, 900),
            (1535, 864),
            (1600, 900),
            (1680, 1050),
            (1769, 992),
            (1920, 1080),
            (1921, 1081),
            (2048, 1152),
            (2160, 1440),
            (2251, 1501),
            (2304, 1440),
            (2400, 1600),
            (2560, 1080),
            (2561, 1081),
            (2560, 1440),
            (2560, 1600),
            (2880, 1800),
            (3001, 2001),
            (3200, 1800),
            (3201, 1801),
            (3440, 1440),
            (3441, 1441),
            (3840, 1600),
            (3840, 2160),
            (3841, 2161),
            (4095, 2160),
            (2160, 4095),
            (1001, 1001),
            (1235, 777),
            (1777, 999),
            (1999, 1111),
            (2111, 1333),
            (2777, 1555),
            (3071, 1729),
            (3333, 2221),
            (3555, 1999),
            (3777, 2111),
            (3999, 2223),
        ];
        assert_eq!(sizes.len(), 50);
        for (width, height) in sizes {
            let block = edid_for(width, height, 60);
            assert_eq!(
                block.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
                0
            );
            assert_eq!(dtd_active(&block), (width, height), "size {width}x{height}");
        }
    }

    #[test]
    fn out_of_range_inputs_are_bounded() {
        let block = edid_for(0, u32::MAX, 0);
        assert_eq!(dtd_active(&block), (1, MAX_EDID_DIMENSION));
        assert_eq!(
            block.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
            0
        );
    }
}
