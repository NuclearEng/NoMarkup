use criterion::{criterion_group, criterion_main, Criterion};
use image::{DynamicImage, RgbaImage};

/// Create a solid-color test image of the given dimensions.
fn make_test_image(w: u32, h: u32) -> DynamicImage {
    let img = RgbaImage::from_fn(w, h, |x, y| {
        // Produce a gradient pattern for more realistic compression behavior.
        let r = ((x * 255) / w.max(1)) as u8;
        let g = ((y * 255) / h.max(1)) as u8;
        let b = 128u8;
        image::Rgba([r, g, b, 255])
    });
    DynamicImage::ImageRgba8(img)
}

/// Benchmark resizing a 1080p image to various target sizes.
fn bench_resize(c: &mut Criterion) {
    let img_1080 = make_test_image(1920, 1080);

    c.bench_function("resize_fit_1080p_to_800x600", |b| {
        b.iter(|| {
            img_1080.resize(800, 600, image::imageops::FilterType::Lanczos3)
        });
    });

    c.bench_function("resize_exact_1080p_to_200x200", |b| {
        b.iter(|| {
            img_1080.resize_exact(200, 200, image::imageops::FilterType::Lanczos3)
        });
    });
}

/// Benchmark encoding to WebP format.
fn bench_webp_encode(c: &mut Criterion) {
    let img = make_test_image(800, 600);

    c.bench_function("encode_webp_800x600", |b| {
        b.iter(|| {
            let mut buf = std::io::Cursor::new(Vec::new());
            img.write_to(&mut buf, image::ImageFormat::WebP)
                .expect("encode WebP");
            buf.into_inner()
        });
    });
}

/// Benchmark encoding to JPEG format.
fn bench_jpeg_encode(c: &mut Criterion) {
    let img = make_test_image(800, 600);

    c.bench_function("encode_jpeg_800x600_q85", |b| {
        b.iter(|| {
            let mut buf = std::io::Cursor::new(Vec::new());
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
            img.write_with_encoder(encoder).expect("encode JPEG");
            buf.into_inner()
        });
    });
}

/// Benchmark BlurHash computation on a small image (simulating the 32x32
/// downscale that `compute_blur_hash` performs internally).
fn bench_blurhash_computation(c: &mut Criterion) {
    let img = make_test_image(32, 32).to_rgba8();
    let (sw, sh) = (img.width() as usize, img.height() as usize);

    // Pre-compute linear RGB pixels.
    let pixels: Vec<[f64; 3]> = img
        .pixels()
        .map(|p| {
            [
                srgb_to_linear(p.0[0]),
                srgb_to_linear(p.0[1]),
                srgb_to_linear(p.0[2]),
            ]
        })
        .collect();

    let components_x: usize = 4;
    let components_y: usize = 3;

    c.bench_function("blurhash_dct_32x32_4x3", |b| {
        b.iter(|| {
            let mut factors: Vec<[f64; 3]> = Vec::with_capacity(components_x * components_y);
            for j in 0..components_y {
                for i in 0..components_x {
                    let mut r = 0.0_f64;
                    let mut g = 0.0_f64;
                    let mut bl = 0.0_f64;
                    for y in 0..sh {
                        for x in 0..sw {
                            let basis =
                                (std::f64::consts::PI * (i as f64) * (x as f64) / sw as f64)
                                    .cos()
                                    * (std::f64::consts::PI * (j as f64) * (y as f64) / sh as f64)
                                        .cos();
                            let px = &pixels[y * sw + x];
                            r += basis * px[0];
                            g += basis * px[1];
                            bl += basis * px[2];
                        }
                    }
                    let scale = if i == 0 && j == 0 {
                        1.0 / (sw * sh) as f64
                    } else {
                        2.0 / (sw * sh) as f64
                    };
                    factors.push([r * scale, g * scale, bl * scale]);
                }
            }
            factors
        });
    });
}

/// Benchmark the full pipeline: decode -> resize -> encode -> BlurHash.
fn bench_full_pipeline(c: &mut Criterion) {
    // Create a 1080p JPEG in memory to simulate a realistic input.
    let img = make_test_image(1920, 1080);
    let mut jpeg_buf = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, 85);
    img.write_with_encoder(encoder).expect("encode JPEG");
    let jpeg_bytes = jpeg_buf.into_inner();

    c.bench_function("full_pipeline_1080p_jpeg_to_800_webp", |b| {
        b.iter(|| {
            // Decode.
            let decoded = image::load_from_memory(&jpeg_bytes).expect("decode");
            // Resize.
            let resized = decoded.resize(800, 800, image::imageops::FilterType::Lanczos3);
            // Encode to WebP.
            let mut out = std::io::Cursor::new(Vec::new());
            resized
                .write_to(&mut out, image::ImageFormat::WebP)
                .expect("encode WebP");
            // BlurHash (downscale to 32x32 then DCT).
            let small = resized.resize_exact(32, 32, image::imageops::FilterType::Lanczos3);
            let _ = small.to_rgba8();
            out.into_inner()
        });
    });
}

fn srgb_to_linear(value: u8) -> f64 {
    let v = f64::from(value) / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

criterion_group!(
    benches,
    bench_resize,
    bench_webp_encode,
    bench_jpeg_encode,
    bench_blurhash_computation,
    bench_full_pipeline,
);
criterion_main!(benches);
