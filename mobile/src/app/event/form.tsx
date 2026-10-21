import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Body, Button, Choice, ErrorText, Input, Screen } from '@/components/ui';
import { api, errorMessage, type EventInput } from '@/lib/api';
import { confirm } from '@/lib/hooks';
import { currentPosition } from '@/lib/location';
import type { EventLicense, Visibility } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromLocal = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s.trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

/** Creates an event, or edits it when an id is given. */
export default function EventForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [license, setLicense] = useState<EventLicense>('EVERYONE');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const now = new Date();
  const [start, setStart] = useState(toLocal(now));
  const [end, setEnd] = useState(toLocal(new Date(now.getTime() + 2 * 3600_000)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.events.get(id).then((e) => {
      setName(e.name);
      setDescription(e.description ?? '');
      setVisibility(e.visibility);
      setLicense(e.license);
      if (e.location) {
        setLat(String(e.location.latitude));
        setLng(String(e.location.longitude));
        setRadius(String(e.location.radiusMeters));
      }
      if (e.voteWindow) {
        setStart(toLocal(new Date(e.voteWindow.startsAt)));
        setEnd(toLocal(new Date(e.voteWindow.endsAt)));
      }
    });
  }, [id]);

  async function here() {
    const geo = await currentPosition();
    if (!geo) return setError('Location permission refused');
    setLat(geo.latitude.toFixed(6));
    setLng(geo.longitude.toFixed(6));
  }

  async function save() {
    setError(null);
    const body: EventInput = { name: name.trim(), description: description.trim() || null, visibility, license };
    if (license === 'LOCATION_TIME') {
      const startsAt = fromLocal(start);
      const endsAt = fromLocal(end);
      if (!startsAt || !endsAt) return setError('Dates must look like 2026-06-21 16:00');
      if (!lat || !lng) return setError('Set the event location');
      body.location = { latitude: Number(lat), longitude: Number(lng), radiusMeters: Number(radius) || 200 };
      body.voteWindow = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    } else if (id) {
      body.location = null;
      body.voteWindow = null;
    }
    try {
      const event = id ? await api.events.update(id, body) : await api.events.create(body);
      router.replace(`/event/${event.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!id || !(await confirm('Delete this event?', 'This cannot be undone.'))) return;
    try {
      await api.events.remove(id);
      router.dismissAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Screen>
      <Input label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Input label="Description" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" />
      <Choice
        label="Who can find the event"
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: 'PUBLIC', label: 'Everyone (public)' },
          { value: 'PRIVATE', label: 'Invited only (private)' },
        ]}
      />
      <Choice
        label="Who can vote (license)"
        value={license}
        onChange={setLicense}
        options={[
          { value: 'EVERYONE', label: 'Everyone' },
          { value: 'INVITED_ONLY', label: 'Invited only' },
          { value: 'LOCATION_TIME', label: 'On site, on time' },
        ]}
      />
      {license === 'LOCATION_TIME' ? (
        <>
          <Body muted>Only people within the radius, during the time window, can vote.</Body>
          <Input label="Latitude" value={lat} onChangeText={setLat} keyboardType="numeric" />
          <Input label="Longitude" value={lng} onChangeText={setLng} keyboardType="numeric" />
          <Button small variant="secondary" title="Use my current position" onPress={here} />
          <Input label="Radius (meters)" value={radius} onChangeText={setRadius} keyboardType="numeric" />
          <Input label="Vote starts (YYYY-MM-DD HH:mm)" value={start} onChangeText={setStart} />
          <Input label="Vote ends (YYYY-MM-DD HH:mm)" value={end} onChangeText={setEnd} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Create'} onPress={save} disabled={!name.trim()} />
      {id ? <Button title="Delete event" variant="danger" onPress={remove} /> : null}
    </Screen>
  );
}
