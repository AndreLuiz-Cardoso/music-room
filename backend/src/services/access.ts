import { prisma } from '../db';
import { canControlDevice, canSeeEvent, canSeePlaylist } from '../domain/policies';

// Database-backed versions of the read rules, used to authorize real-time subscriptions.

export async function canAccessEvent(userId: string, eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true, visibility: true, invites: { where: { userId }, select: { userId: true } } },
  });
  return !!event && canSeeEvent(event, { userId, invited: event.invites.length > 0 });
}

export async function canAccessPlaylist(userId: string, playlistId: string): Promise<boolean> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    select: { ownerId: true, visibility: true, invites: { where: { userId }, select: { userId: true } } },
  });
  return !!playlist && canSeePlaylist(playlist, { userId, invited: playlist.invites.length > 0 });
}

export async function canAccessDevice(userId: string, deviceId: string): Promise<boolean> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { ownerId: true, delegations: { where: { delegateId: userId }, select: { expiresAt: true } } },
  });
  return !!device && canControlDevice(device, userId, device.delegations[0] ?? null, new Date());
}

export async function canAccessRoom(userId: string, room: string): Promise<boolean> {
  const [kind, id] = room.split(':');
  if (!id) return false;
  switch (kind) {
    case 'event':
      return canAccessEvent(userId, id);
    case 'playlist':
      return canAccessPlaylist(userId, id);
    case 'device':
      return canAccessDevice(userId, id);
    default:
      return false;
  }
}
