export interface SubtitleLine {
    id: string;
    startTimeMs: string;
    words: string;
    syllables: never[];
    endTimeMs: string;
}

export function parseSubtitle(data: unknown): SubtitleLine[] | null {
    let body = (data as any)?.message?.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch { return null; }
    }
    const raw = body?.subtitle?.subtitle_body as string | undefined;
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        const lines = (parsed as any[]).map((line, i): SubtitleLine => ({
            id: String(i),
            startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
            words: line.text ?? '',
            syllables: [],
            endTimeMs: '0', // Placeholder
        }));

        // Post-process to fix endTimeMs (heuristic: next line's start time)
        for (let i = 0; i < lines.length; i++) {
            if (i < lines.length - 1) {
                lines[i].endTimeMs = lines[i + 1].startTimeMs;
            } else {
                // Final line: assume 3 second duration
                lines[i].endTimeMs = String(Number(lines[i].startTimeMs) + 3000);
            }
        }
        return lines;
    } catch { return null; }
}
