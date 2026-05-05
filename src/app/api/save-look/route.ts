import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── Request Body Schema ───

interface SaveLookRequest {
  name: string;
  description?: string;
  category: string;
  thumbnail?: string;
  favorite?: boolean;
  data: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: SaveLookRequest = await request.json();

    // Validate required fields
    const { name, category, data } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid "name". Expected a non-empty string.' },
        { status: 400 }
      );
    }

    if (!category || typeof category !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "category". Expected a string.' },
        { status: 400 }
      );
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json(
        { error: 'Missing or invalid "data". Expected a non-null object containing look parameters.' },
        { status: 400 }
      );
    }

    // Serialize the look data to JSON string for storage
    const dataJson = JSON.stringify(data);

    // Validate the data is valid JSON and not excessively large
    if (dataJson.length > 2_000_000) {
      return NextResponse.json(
        { error: 'Look data is too large. Maximum size is 2MB.' },
        { status: 400 }
      );
    }

    // Save to database
    const savedLook = await db.savedLook.create({
      data: {
        name: name.trim(),
        description: body.description?.trim() || null,
        category: category.trim(),
        thumbnail: body.thumbnail || null,
        favorite: body.favorite ?? false,
        data: dataJson,
      },
    });

    // Parse the stored data back to include in response
    let parsedData: Record<string, unknown>;
    try {
      parsedData = JSON.parse(savedLook.data);
    } catch {
      parsedData = {};
    }

    return NextResponse.json(
      {
        id: savedLook.id,
        name: savedLook.name,
        description: savedLook.description,
        category: savedLook.category,
        thumbnail: savedLook.thumbnail,
        favorite: savedLook.favorite,
        data: parsedData,
        createdAt: savedLook.createdAt.toISOString(),
        updatedAt: savedLook.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error saving look:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save look. A database error occurred.' },
      { status: 500 }
    );
  }
}
