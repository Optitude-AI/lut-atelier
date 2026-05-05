import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // Fetch all saved looks, ordered by most recently created first
    const savedLooks = await db.savedLook.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Parse the JSON data field for each look
    const looks = savedLooks.map((look) => {
      let parsedData: Record<string, unknown>;
      try {
        parsedData = JSON.parse(look.data);
      } catch {
        parsedData = {};
      }

      return {
        id: look.id,
        name: look.name,
        description: look.description,
        category: look.category,
        thumbnail: look.thumbnail,
        favorite: look.favorite,
        data: parsedData,
        createdAt: look.createdAt.toISOString(),
        updatedAt: look.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ looks }, { status: 200 });
  } catch (error) {
    console.error('Error loading looks:', error);

    return NextResponse.json(
      { error: 'Failed to load saved looks. A database error occurred.' },
      { status: 500 }
    );
  }
}
