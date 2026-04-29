export interface SubtitleLine {
    id: string;
    startTimeMs: string;
    words: string;
    syllables: never[];
    endTimeMs: string;
}

export function parseSubtitle(data: unknown): SubtitleLine[] | null {
    const raw = (data as any)?.message?.body?.subtitle?.subtitle_body as string | undefined;
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        return (parsed as any[]).map((line, i): SubtitleLine => ({
            id: String(i),
            startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
            words: line.text ?? '',
            syllables: [],
            endTimeMs: '0',
        }));
    } catch { return null; }
}
