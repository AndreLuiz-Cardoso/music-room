import { Button } from '@/components/ui';
import { type GoogleButtonProps, googleIdToken } from '@/lib/social';

// Native: our button opens the Google account picker (the web version renders Google's own button).

export function GoogleButton({ purpose, onPress }: GoogleButtonProps) {
  return purpose === 'login' ? (
    <Button title="Continue with Google" variant="secondary" onPress={() => onPress(googleIdToken)} />
  ) : (
    <Button small variant="secondary" title="Link" onPress={() => onPress(googleIdToken)} />
  );
}
