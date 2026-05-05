import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  applyColorGradePixel,
  type CurveData,
  type ChannelData,
  type GridNode,
  type CLGridNode,
  type ColorGradeParams,
} from '@/lib/lut-engine';

// ─── Request Body Schema ───

interface ExportImageRequest {
  imageDataUrl: string;
  format: 'png' | 'jpeg' | 'tiff';
  quality: number;
  width: number;
  height: number;
  curveData: CurveData[];
  channelData: Record<string, ChannelData>;
  abNodes: GridNode[];
  clNodes: CLGridNode[];
  globalIntensity: number;
}

/**
 * Decode a base64 data URL into a raw Buffer.
 * Handles data:image/png;base64,... and data:image/jpeg;base64,... formats.
 */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; type: string } {
  const matches = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
  if (!matches || matches.length < 3) {
    throw new Error('Invalid image data URL format. Expected: data:image/<format>;base64,<data>');
  }
  return {
    buffer: Buffer.from(matches[2], 'base64'),
    type: matches[1].toLowerCase(),
  };
}

/**
 * Process raw RGBA pixel buffer through the color grading pipeline using sharp's raw API.
 */
async function gradeImage(
  inputBuffer: Buffer,
  params: ColorGradeParams,
  format: 'png' | 'jpeg' | 'tiff',
  quality: number
): Promise<Buffer> {
  // Decode to raw pixels using sharp
  const pipeline = sharp(inputBuffer)
    .ensureAlpha() // Ensure alpha channel is present
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = await pipeline;
  const { width, height, channels } = info;

  // Create a typed array view of the pixel data
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);

  // Process each pixel through the color grading pipeline
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (i + 2 >= pixels.length) continue;

      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;

      const [rOut, gOut, bOut] = applyColorGradePixel(r, g, b, params);

      pixels[i] = Math.round(rOut * 255);
      pixels[i + 1] = Math.round(gOut * 255);
      pixels[i + 2] = Math.round(bOut * 255);
      // Alpha channel (pixels[i + 3]) is preserved
    }
  }

  // Encode back to the requested format using sharp
  const sharpInstance = sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: channels as 1 | 2 | 3 | 4,
    },
  });

  switch (format) {
    case 'jpeg':
      return sharpInstance
        .removeAlpha() // JPEG doesn't support alpha
        .jpeg({ quality: Math.max(1, Math.min(100, quality)) })
        .toBuffer();

    case 'tiff':
      return sharpInstance
        .tiff({
          quality: Math.max(1, Math.min(100, quality)),
          compression: 'lzw',
        })
        .toBuffer();

    case 'png':
    default:
      return sharpInstance
        .png({
          compressionLevel: Math.max(0, Math.min(9, Math.round((100 - quality) / 11))),
        })
        .toBuffer();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ExportImageRequest = await request.json();

    // Validate required fields
    const { imageDataUrl, format, quality, curveData, channelData, abNodes, clNodes, globalIntensity } = body;

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "imageDataUrl". Expected a base64 data URL string.' },
        { status: 400 }
      );
    }

    const validFormats = ['png', 'jpeg', 'tiff'];
    if (!format || !validFormats.includes(format)) {
      return NextResponse.json(
        { error: `Missing or invalid "format". Must be one of: ${validFormats.join(', ')}.` },
        { status: 400 }
      );
    }

    if (quality === undefined || typeof quality !== 'number' || quality < 1 || quality > 100) {
      return NextResponse.json(
        { error: 'Missing or invalid "quality". Expected a number between 1 and 100.' },
        { status: 400 }
      );
    }

    // Decode the data URL
    let imageBuffer: Buffer;
    try {
      const decoded = decodeDataUrl(imageDataUrl);
      imageBuffer = decoded.buffer;
    } catch (decodeError) {
      return NextResponse.json(
        { error: 'Failed to decode image data URL. Ensure it is a valid base64-encoded image.' },
        { status: 400 }
      );
    }

    // Validate the image is actually decodable by sharp
    try {
      await sharp(imageBuffer).metadata();
    } catch {
      return NextResponse.json(
        { error: 'Invalid image data. Could not decode the provided image.' },
        { status: 400 }
      );
    }

    // Build color grade params
    const gradeParams: ColorGradeParams = {
      curveData: curveData || [],
      channelData: channelData || {},
      abNodes: abNodes || [],
      clNodes: clNodes || [],
      globalIntensity: globalIntensity !== undefined ? Math.max(0, Math.min(100, globalIntensity)) : 100,
    };

    // Apply color grading to the image
    const outputBuffer = await gradeImage(
      imageBuffer,
      gradeParams,
      format,
      quality
    );

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      tiff: 'image/tiff',
    };
    const contentType = mimeTypes[format] || 'image/png';

    // Return as downloadable image
    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="color-graded.${format === 'jpeg' ? 'jpg' : format}"`,
        'Content-Length': outputBuffer.length.toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting graded image:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to export image. Please check your parameters and try again.' },
      { status: 500 }
    );
  }
}
