/* Server Files Management Commands
*
* Instructions:
* - Important: Obtain a GitHub "personal access token" with the "gist" permission.
* - Set this token as the environment variable `GITHUB_TOKEN` on your server.
* - (Directly adding the token to the code is strongly discouraged for security).
* - These commands are restricted to the 'development' room and whitelisted
* - users with console access for security.
*
* Credits: HoeenHero
* Modified By: @musaddiktemkar
*/

import * as https from 'https';
import { FS } from '../lib/fs';

const WHITELIST = ['princesky'];
const GITHUB_API_URL = 'https://api.github.com/gists';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const DEVELOPMENT_ROOM = 'development';

interface GistResponse {
  id: string;
  html_url: string;
}

interface CommandError {
  message: string;
  cmdToken: string;
}

function fakeUnrecognizedCmd(this: CommandContext, { message, cmdToken }: CommandError) {
  const baseError = `The command '${message}' was unrecognized.`;
  return cmdToken === '!' 
    ? this.errorReply(baseError)
    : this.errorReply(`${baseError} To send a message starting with '${message}', type '${cmdToken}${message}'.`);
}

function validateAccess(room: any, user: any): boolean {
  return room?.roomid === DEVELOPMENT_ROOM && 
         user.hasConsoleAccess(user.connections[0]) && 
         WHITELIST.includes(user.id);
}

async function uploadToGist(content: string, filepath: string, description = 'Uploaded via bot'): Promise<string> {
  if (!GITHUB_TOKEN) {
    throw new Error('GitHub token not found.');
  }

  const filename = filepath.split('/').pop() || filepath;
  const postData = JSON.stringify({
    description,
    public: false,
    files: { [filename]: { content } },
  });

  const reqOpts = {
    hostname: 'api.github.com',
    path: '/gists',
    method: 'POST',
    headers: {
      'User-Agent': 'YourBotName',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
    },
  };

  return new Promise<string>((resolve, reject) => {
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          try {
            const gistResponse: GistResponse = JSON.parse(data);
            resolve(gistResponse.html_url);
          } catch (e) {
            reject(new Error(`Failed to parse GitHub API response: ${e}`));
          }
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function fetchGistContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`Failed to fetch Gist content: ${res.statusCode}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export const commands: Chat.ChatCommands = {
  file: 'getfile',
  fileretrieval: 'getfile',
  retrievefile: 'getfile',
  
  async getfile(this: CommandContext, target, room, user) {
    if (!validateAccess(room, user)) {
      return fakeUnrecognizedCmd.call(this, { message: target, cmdToken: this.cmdToken });
    }
    if (!this.runBroadcast()) return;
    if (!target) return this.parse('/help getfile');
    
    if (!GITHUB_TOKEN) {
      return this.errorReply("GitHub token not configured. Please set the GITHUB_TOKEN environment variable.");
    }

    try {
      const fileData = await FS(target.trim()).read();
      const gistUrl = await uploadToGist(fileData, target, `File: ${target} uploaded by ${user.id}`);
      this.sendReplyBox(`File: <a href="${gistUrl}">${gistUrl}</a>`);
    } catch (error) {
      this.errorReply(`Operation failed: ${error}`);
    }
    
    if (room) room.update();
  },

  getfilehelp: [
    '/getgile <file name>: Uploads a server file to a private GitHub Gist.',
    'Example: /getfile config/config.js',
    'Note: Requires the GITHUB_TOKEN environment variable to be set.',
  ],

  forcewritefile: 'writefile',
  async writefile(this: CommandContext, target, room, user, connection, cmd) {
    if (!validateAccess(room, user)) {
      return fakeUnrecognizedCmd.call(this, { message: target, cmdToken: this.cmdToken });
    }
    if (!this.runBroadcast()) return;

    const [gistUrl, targetFile] = target.split(',').map(x => x.trim());
    if (!gistUrl || !targetFile) {
      return this.errorReply('/writefile [github gist raw link to write from], [file to write too]');
    }
    if (!gistUrl.startsWith('https://gist.githubusercontent.com/')) {
      return this.errorReply('Link must start with https://gist.githubusercontent.com/');
    }

    try {
      if (cmd !== 'forcewritefile') {
        try {
          await FS(targetFile).readSync();
        } catch {
          return this.errorReply(
            `The file "${targetFile}" was not found. Use /forcewritefile to forcibly create & write to the file.`
          );
        }
      }

      const content = await fetchGistContent(gistUrl);
      await FS(targetFile).writeSync(content);
      this.sendReplyBox(`"${targetFile}" written successfully`);
    } catch (error) {
      this.errorReply(`An error occurred while fetching or writing the file: ${error}`);
    }
  },
};
