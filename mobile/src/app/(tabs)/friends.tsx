import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Body, Button, Card, Empty, ErrorText, Input, Loading, Row, Screen, Section, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { attempt, useLoader } from '@/lib/hooks';
import type { UserSummary } from '@/lib/types';

function UserRow({ user, children }: { user: UserSummary; children?: React.ReactNode }) {
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.push(`/user/${user.id}`)} style={{ flex: 1 }}>
          <Body>{user.displayName}</Body>
          {user.musicPreferences.length ? <Body muted>{user.musicPreferences.join(', ')}</Body> : null}
        </Pressable>
        <Row>{children}</Row>
      </Row>
    </Card>
  );
}

export default function FriendsScreen() {
  const { data, error, loading, reload } = useLoader(() => api.friends.list());
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [results, setResults] = useState<UserSummary[] | null>(null);

  const q = query.trim();
  const g = genre.trim();
  const searching = q.length >= 2 || !!g;
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => api.users.search(q.length >= 2 ? q : undefined, g || undefined).then(setResults).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q, g, searching]);

  const add = (id: string) => attempt(() => api.friends.request(id)).then(reload);
  const remove = (id: string) => attempt(() => api.friends.remove(id)).then(reload);
  const known = new Set([...(data?.friends ?? []), ...(data?.sent ?? []), ...(data?.received ?? [])].map((u) => u.id));

  return (
    <Screen>
      <Title>Friends</Title>
      <Input placeholder="Find people by name" value={query} onChangeText={setQuery} />
      <Input placeholder="...or by music taste (rock, jazz...)" value={genre} onChangeText={setGenre} />
      {searching && results ? (
        <Section title="Results">
          {results.length === 0 ? <Empty text="Nobody found" /> : null}
          {results.map((u) => (
            <UserRow key={u.id} user={u}>
              {known.has(u.id) ? null : <Button small title="Add" onPress={() => add(u.id)} />}
            </UserRow>
          ))}
        </Section>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {loading && !data ? <Loading /> : null}
      {data?.received.length ? (
        <Section title="Requests received">
          {data.received.map((u) => (
            <UserRow key={u.id} user={u}>
              <Button small title="Accept" onPress={() => add(u.id)} />
              <Button small variant="secondary" title="Decline" onPress={() => remove(u.id)} />
            </UserRow>
          ))}
        </Section>
      ) : null}
      <Section title="My friends">
        {data?.friends.length === 0 ? <Empty text="No friend yet" /> : null}
        {data?.friends.map((u) => (
          <UserRow key={u.id} user={u}>
            <Button small variant="secondary" title="Remove" onPress={() => remove(u.id)} />
          </UserRow>
        ))}
      </Section>
      {data?.sent.length ? (
        <Section title="Requests sent">
          {data.sent.map((u) => (
            <UserRow key={u.id} user={u}>
              <Button small variant="secondary" title="Cancel" onPress={() => remove(u.id)} />
            </UserRow>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
