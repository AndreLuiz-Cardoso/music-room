import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { playlistLicenseOptions, visibilityOptions } from '@/components/shared';
import { Button, Choice, ErrorText, Input, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { confirmDelete } from '@/lib/hooks';
import type { PlaylistLicense, Visibility } from '@/lib/types';

/** Creates a playlist, or edits it when an id is given. */
export default function PlaylistForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [license, setLicense] = useState<PlaylistLicense>('EVERYONE');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.playlists.get(id).then((p) => {
      setName(p.name);
      setDescription(p.description ?? '');
      setVisibility(p.visibility);
      setLicense(p.license);
    });
  }, [id]);

  async function save() {
    setError(null);
    const body = { name: name.trim(), description: description.trim() || null, visibility, license };
    try {
      const p = id ? await api.playlists.update(id, body) : await api.playlists.create(body);
      router.replace(`/playlist/${p.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (id) setError(await confirmDelete('playlist', () => api.playlists.remove(id)));
  }

  return (
    <Screen>
      <Input label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Input label="Description" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" />
      <Choice
        label="Who can access it"
        value={visibility}
        onChange={setVisibility}
        options={visibilityOptions}
      />
      <Choice
        label="Who can edit it"
        value={license}
        onChange={setLicense}
        options={playlistLicenseOptions}
      />
      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Create'} onPress={save} disabled={!name.trim()} />
      {id ? <Button title="Delete playlist" variant="danger" onPress={remove} /> : null}
    </Screen>
  );
}
