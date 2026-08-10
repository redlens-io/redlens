import * as vscode from 'vscode';
import { secretKeyForProfile, type ConnectionProfile } from './profile';

const SETTINGS_SECTION = 'redlens';
const SETTINGS_KEY = 'connections';

/**
 * Persistence for profiles (settings) and passwords (SecretStorage).
 * Settings hold zero secrets — safe to sync/commit.
 */
export class ConnectionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getProfiles(): ConnectionProfile[] {
    const raw = vscode.workspace.getConfiguration(SETTINGS_SECTION).get<unknown[]>(SETTINGS_KEY, []);
    return raw.filter(isProfileLike);
  }

  getProfile(id: string): ConnectionProfile | undefined {
    return this.getProfiles().find((p) => p.id === id);
  }

  async saveProfile(profile: ConnectionProfile, password: string | undefined): Promise<void> {
    const rest = this.getProfiles().filter((p) => p.id !== profile.id);
    await vscode.workspace
      .getConfiguration(SETTINGS_SECTION)
      .update(SETTINGS_KEY, [...rest, profile], vscode.ConfigurationTarget.Global);
    if (password !== undefined) {
      await this.secrets.store(secretKeyForProfile(profile.id), password);
    }
  }

  async deleteProfile(id: string): Promise<void> {
    const rest = this.getProfiles().filter((p) => p.id !== id);
    await vscode.workspace.getConfiguration(SETTINGS_SECTION).update(SETTINGS_KEY, rest, vscode.ConfigurationTarget.Global);
    await this.secrets.delete(secretKeyForProfile(id));
  }

  getPassword(id: string): Thenable<string | undefined> {
    return this.secrets.get(secretKeyForProfile(id));
  }
}

function isProfileLike(value: unknown): value is ConnectionProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.host === 'string' &&
    typeof p.port === 'number' &&
    typeof p.database === 'string' &&
    typeof p.username === 'string'
  );
}
