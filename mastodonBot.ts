import { createRestAPIClient } from "masto";
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import dotenv from 'dotenv';

dotenv.config();

// Define the structure of the data we want to save in the database
interface PlaylistEntry {
  name: string;
  uri: string;
  imageUrl: string;
  artistNames: string[];
  posted_count?: number; // posted_count is optional
}

// Define the database structure
interface Database {
  playlists: PlaylistEntry[];
}

// Database class
class PlaylistDatabase {
  private db: Low<Database>;

  constructor() {
    const adapter = new JSONFile<Database>('playlists_database.json');
    this.db = new Low(adapter, { playlists: [] });
  }

  async read(): Promise<void> {
    await this.db.read();
  }

  async write(): Promise<void> {
    await this.db.write();
  }

  getLowestPostedCountPlaylist(): PlaylistEntry | null {
    if (!this.db.data) throw new Error("Database not loaded");

    // Find the minimum posted_count, treating undefined as 0
    const minPostedCount = Math.min(...this.db.data.playlists.map(p => p.posted_count ?? 0));

    // Get playlists with the minimum posted_count
    const candidatePlaylists = this.db.data.playlists.filter(p => (p.posted_count ?? 0) === minPostedCount);
    
    // Return a random candidate playlist
    return candidatePlaylists[Math.floor(Math.random() * candidatePlaylists.length)] || null;
  }

  async incrementPostedCount(playlistUri: string): Promise<void> {
    if (!this.db.data) throw new Error("Database not loaded");
    
    const playlist = this.db.data.playlists.find(p => p.uri === playlistUri);
    if (playlist) {
      // Increment posted_count, initializing it if it doesn't exist
      playlist.posted_count = (playlist.posted_count ?? 0) + 1;
      await this.write();
    }
  }
}

// Mastodon Client
class MastodonClient {
  private client: ReturnType<typeof createRestAPIClient>;

  constructor(url: string, accessToken: string) {
    this.client = createRestAPIClient({
      url,
      accessToken,
    });
  }

  async createStatus(status: string): Promise<string> {
    const postedStatus = await this.client.v1.statuses.create({ status });
    return postedStatus?.id || '';
  }
}

// Playlist Bot
class PlaylistBot {
  private db: PlaylistDatabase;
  private mastodon: MastodonClient;

  constructor() {
    this.db = new PlaylistDatabase();
    const mastodonUrl = process.env.MASTODON_URL;
    const mastodonToken = process.env.MASTODON_ACCESS_TOKEN;
    
    if (!mastodonUrl || !mastodonToken) {
      throw new Error('MASTODON_URL or MASTODON_ACCESS_TOKEN is not set in the environment variables');
    }
    
    this.mastodon = new MastodonClient(mastodonUrl, mastodonToken);
  }

  async postRandomPlaylist(dryRun: boolean = false): Promise<void> {
    await this.db.read();
    const playlist = this.db.getLowestPostedCountPlaylist();

    if (!playlist) {
      console.log("No playlists available to post.");
      return;
    }

    const artists = playlist.artistNames.slice(0, 3).join(', '); // Get the first three artists
    const urlFromUri = `https://open.spotify.com/playlist/${playlist.uri.split(':').pop()}`;
    const cleanName = playlist.name.replace(' Mix', '')
    const statusText = `${cleanName}\nFeaturing ${artists}\n\n${urlFromUri}`;

    if (dryRun) {
      console.log('--- DRY RUN ---');
      console.log('Status Text:', statusText);
      console.log('--- END DRY RUN ---');
      return;
    }

    try {
      const statusId = await this.mastodon.createStatus(statusText);
      console.log('Posted successfully:', statusId);
      await this.db.incrementPostedCount(playlist.uri);
    } catch (error) {
      console.error('Error posting to Mastodon:', error);
    }
  }
}

// Main execution
async function main() {
  const bot = new PlaylistBot();
  const dryRun = process.argv.includes('--dry-run'); // Check for --dry-run flag
  await bot.postRandomPlaylist(dryRun);
}

main().catch(console.error);