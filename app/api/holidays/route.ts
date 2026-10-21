import { NextResponse } from 'next/server';
import { getHolidayData } from '@/lib/holiday-service';

export const revalidate = 86400;
const cacheHeaders = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };

export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: '연도는 1900년부터 2100년 사이로 입력해 주세요.' }, { status: 400 });
  }
  return NextResponse.json(await getHolidayData(year), { headers: cacheHeaders });
}
