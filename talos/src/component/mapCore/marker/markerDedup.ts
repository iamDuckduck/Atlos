import type { IMarkerData } from '@/data/marker';

const getPositionTypeKey = (marker: IMarkerData): string =>
    JSON.stringify([marker.type, marker.x, marker.y, marker.z]);

/** Keep the first marker for each exact 3D position and marker type. */
export const deduplicateMarkersByPositionAndType = (
    markers: IMarkerData[],
): IMarkerData[] => {
    const seen = new Set<string>();

    return markers.filter((marker) => {
        const key = getPositionTypeKey(marker);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
