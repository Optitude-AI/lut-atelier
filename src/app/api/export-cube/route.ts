import { NextRequest, NextResponse } from 'next/server';
import {
  generateCubeLUT,
  type CurveData,
  type ChannelData,
  type GridNode,
  type CLGridNode,
} from '@/lib/lut-engine';

// ─── Request Body Schema ───

interface ExportCubeRequest {
  name: string;
  gridSize: number;
  curveData: CurveData[];
  channelData: Record<string, ChannelData>;
  abNodes: GridNode[];
  clNodes: CLGridNode[];
  globalIntensity: number;
  colorSpace: string;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body: ExportCubeRequest = await request.json();

    // Validate required fields
    const { name, gridSize, curveData, channelData, abNodes, clNodes, globalIntensity, colorSpace } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "name" field. Expected a non-empty string.' },
        { status: 400 }
      );
    }

    if (!gridSize || typeof gridSize !== 'number' || gridSize < 2 || gridSize > 256) {
      return NextResponse.json(
        { error: 'Missing or invalid "gridSize". Must be a number between 2 and 256.' },
        { status: 400 }
      );
    }

    // Validate gridSize is a reasonable 3D LUT size (powers of 2 + 1 common, but allow any)
    const validGridSizes = [2, 3, 4, 5, 7, 9, 17, 33, 65, 129];
    if (!validGridSizes.includes(gridSize)) {
      // Allow non-standard sizes but log a warning via response header
      console.warn(`Non-standard grid size ${gridSize} requested. Common sizes: 17, 33, 65.`);
    }

    if (!Array.isArray(curveData)) {
      return NextResponse.json(
        { error: 'Missing or invalid "curveData". Expected an array of curve objects.' },
        { status: 400 }
      );
    }

    if (!channelData || typeof channelData !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid "channelData". Expected an object with channel adjustments.' },
        { status: 400 }
      );
    }

    if (globalIntensity === undefined || typeof globalIntensity !== 'number') {
      return NextResponse.json(
        { error: 'Missing or invalid "globalIntensity". Expected a number (0-100).' },
        { status: 400 }
      );
    }

    // Generate the .cube LUT content
    const cubeContent = generateCubeLUT(name, gridSize, {
      curveData: curveData || [],
      channelData: channelData || {},
      abNodes: abNodes || [],
      clNodes: clNodes || [],
      globalIntensity: Math.max(0, Math.min(100, globalIntensity)),
    });

    // Sanitize filename: replace spaces and special chars with hyphens
    const safeName = name
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Return as downloadable .cube file
    return new NextResponse(cubeContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${safeName}.cube"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error generating .cube LUT:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate .cube LUT file. Please check your parameters.' },
      { status: 500 }
    );
  }
}
