import { HttpError } from './http.js'

export interface CheckinLocation {
  latitude: number
  longitude: number
  accuracy: number
}

export const LOCATION_MESSAGE = 'ไม่สามารถยืนยันตำแหน่งสำหรับเช็กอินได้ กรุณาเปิดตำแหน่งบนโทรศัพท์และลองใหม่อีกครั้ง'

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (n: number) => (n * Math.PI) / 180
  const earth = 6_371_000
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function validateCheckinLocation(
  raw: Partial<CheckinLocation> | null | undefined,
  settings: {
    officeLatitude: number
    officeLongitude: number
    checkinRadiusMeters: number
    maxLocationAccuracyMeters: number
  },
): CheckinLocation & { distance: number } {
  const latitude = Number(raw?.latitude)
  const longitude = Number(raw?.longitude)
  const accuracy = Number(raw?.accuracy)
  const invalid =
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy < 0 ||
    accuracy > settings.maxLocationAccuracyMeters
  if (invalid) throw new HttpError(400, LOCATION_MESSAGE, 'location_required')
  const distance = haversineMeters(latitude, longitude, settings.officeLatitude, settings.officeLongitude)
  if (distance > settings.checkinRadiusMeters) throw new HttpError(403, LOCATION_MESSAGE, 'outside_geofence')
  return { latitude, longitude, accuracy, distance }
}
