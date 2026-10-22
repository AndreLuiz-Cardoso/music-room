import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import type { Track, UserSummary } from '@/lib/types';
import { Body, Button, Empty, ErrorText, Input, Loading, Title, TrackLine, colors, space, styles } from './ui';

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, styles.pad, { paddingTop: space.xxl }]}>
        <Title right={<Button small variant="secondary" title="Close" onPress={onClose} />}>{title}</Title>
        {children}
      </View>
    </Modal>
  );
}

/** Searches the music catalog through the back-end. */
export function TrackPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (t: Track) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(query.trim());

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.tracks.search(q);
        if (!cancelled) {
          setResults(r);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);
  const shown = q ? results : [];

  return (
    <Sheet visible={visible} title="Add a track" onClose={onClose}>
      <Input placeholder="Artist, title..." value={query} onChangeText={setQuery} autoFocus />
      <ErrorText>{error}</ErrorText>
      {loading ? <Loading /> : null}
      <FlatList
        data={shown}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={q && !loading ? <Empty text="No result" /> : undefined}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item)}>
            <TrackLine title={item.title} artist={item.artist} coverUrl={item.coverUrl} right={<Ionicons name="add-circle-outline" size={20} color={colors.text} />} />
          </Pressable>
        )}
      />
    </Sheet>
  );
}

/** Picks a user: friends first, then a search by name. */
export function UserPicker({
  visible,
  title,
  onClose,
  onPick,
  friendsOnly,
  exclude = [],
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onPick: (u: UserSummary) => void;
  friendsOnly?: boolean;
  exclude?: string[];
}) {
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<UserSummary[]>([]);
  const [results, setResults] = useState<UserSummary[]>([]);
  const q = useDebounced(query.trim());

  useEffect(() => {
    if (visible) api.friends.list().then((f) => setFriends(f.friends)).catch(() => {});
  }, [visible]);

  const searching = !friendsOnly && q.length >= 2;
  useEffect(() => {
    if (searching) api.users.search(q).then(setResults).catch(() => setResults([]));
  }, [q, searching]);

  const filter = (list: UserSummary[]) =>
    list.filter((u) => !exclude.includes(u.id) && (!q || u.displayName.toLowerCase().includes(q.toLowerCase())));
  const list = searching ? filter(results) : filter(friends);

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <Input placeholder={friendsOnly ? 'Filter friends' : 'Search users by name'} value={query} onChangeText={setQuery} />
      <FlatList
        data={list}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text={friendsOnly ? 'No friend to show' : 'Type at least 2 letters'} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item)} style={[styles.card, styles.rowBetween]}>
            <Body>{item.displayName}</Body>
            <Text style={styles.link}>Select</Text>
          </Pressable>
        )}
      />
    </Sheet>
  );
}
