import { Directory, File, Paths } from "expo-file-system";
import type { LocalStore } from "./cache";

export class ExpoFileStore implements LocalStore {
  private directory(): Directory {
    const directory = new Directory(Paths.document, "diamond-scout-pilot-v1");
    if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
    return directory;
  }

  private file(key: string): File {
    return new File(this.directory(), `${encodeURIComponent(key)}.json`);
  }

  async getItem(key: string): Promise<string | null> {
    const file = this.file(key);
    return file.exists ? file.text() : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.file(key).write(value);
  }

  async removeItem(key: string): Promise<void> {
    const file = this.file(key);
    if (file.exists) file.delete();
  }
}
