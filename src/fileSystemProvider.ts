import * as vscode from 'vscode';
import * as net from 'net';
import { Buffer } from "node:buffer";

export class FileStat implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  constructor() {
    this.type = 0;
    this.ctime = 0;
    this.mtime = 0;
    this.size = 0;
  }
}

const InfoCommand = 0;
const StatCommand = 1;
const ReadDirectoryCommand = 2;
const CreateDirectoryCommand = 3;
const ReadFileCommand = 4;
const WriteFileCommand = 5;
const DeleteCommand = 6;
const RenameCommand = 7;

interface Callback {
  [key: string]: (value: Buffer | PromiseLike<Buffer>) => void;
}

export class AWFS implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
    return new vscode.Disposable(() => { }); //none
  }

  private _socket: net.Socket;
  private _buffer: Buffer;
  private _readQueue: Callback = {};
  private _seqId: number = 0;

  constructor() {
    this._socket = new net.Socket();
    this._socket.setTimeout(5000);

    this._buffer = Buffer.alloc(0);

    this._socket.on('readable', () => {
      let chunk;
      while (null !== (chunk = this._socket.read())) {
        this._buffer = Buffer.concat([this._buffer, chunk]);

        this._parseBuffer();
      }
    });

    this._socket.connect('//./pipe/awfs', () => {
      //this._socket.pause();
    });
  }

  private _parseBuffer() {
    while (true) {
      if (this._buffer.length >= 9 /* type, seqId, size */) {
        let type = this._buffer.readUInt8(0);
        let seqId = this._buffer.readUInt32LE(1);
        let dataSize = this._buffer.readUInt32LE(5);

        if (this._buffer.length >= 9 + dataSize) {
          let buffer = this._buffer.subarray(9, 9 + dataSize); // extract packet
          this._buffer = this._buffer.subarray(9 + dataSize); // trunc tail

          if (type === 0) { // result
            this._processResult(seqId, buffer);
          } else
            if (type === 1) { // event
              //this._processEvent(seqId, buffer);
            }
        } else { return; }
      } else { break; }
    }
  }

  private _processResult(seqId: number, buffer: Buffer) {
    let resolve = this._readQueue[seqId];
    delete this._readQueue[seqId];

    resolve(buffer);
  }

  private _sendCommand(buffer: Buffer): Promise<Buffer> {
    let seqId = ++this._seqId;

    return new Promise((resolve, reject) => {
      this._readQueue[seqId] = resolve;

      let b = Buffer.allocUnsafe(9);
      b.writeUInt8(0); // command
      b.writeUInt32LE(seqId, 1);
      b.writeUInt32LE(buffer.length, 5);
      let packet = Buffer.concat([b, buffer]);

      this._socket.write(packet, (err?: Error) => {
        if (err) {
          reject(err);
        }
      });
    });
  }

  info(): Promise<string> {
    let packetSize = 1;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(InfoCommand, offset); offset += 1; //opcode

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {
        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          let nameLength = b.readUInt32LE(offset); offset += 4; //length of name

          let utf8Decode = new TextDecoder();
          let name = utf8Decode.decode(b.subarray(offset, offset + nameLength)); offset += nameLength;

          resolve(name);
        } else {
          reject();
        }
      }).catch(reject);
    });
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(StatCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); }); //name

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let fs = new FileStat();

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          fs.type = b.readUInt8(offset); offset += 1; //filetype
          fs.ctime = b.readUInt32LE(offset); offset += 4; //ctime
          fs.mtime = b.readUInt32LE(offset); offset += 4; //mtime
          fs.size = b.readUInt32LE(offset); //size

          resolve(fs);
        } else {
          throw vscode.FileSystemError.FileNotFound(uri);
        }

      }).catch(reject);
    });
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(ReadDirectoryCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); }); //name

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          let num = b.readUInt32LE(offset); offset += 4; //number of entries

          let items: [string, vscode.FileType][] = [];
          let utf8Decode = new TextDecoder();

          let fileNameSize, fileName, fileType;
          for (let i = 0; i < num; i++) {
            fileNameSize = b.readUInt32LE(offset); offset += 4;
            fileName = utf8Decode.decode(b.subarray(offset, offset + fileNameSize)); offset += fileNameSize;
            fileType = b.readUInt8(offset); offset += 1;

            items.push([fileName, fileType]);
          }

          resolve(items);
        } else {
          throw vscode.FileSystemError.FileNotFound(uri);
        }

      }).catch(reject);
    });
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(CreateDirectoryCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); }); //name

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          resolve();
        } else
          if (error === 2) {
            throw vscode.FileSystemError.FileNotFound(uri);
          } else
            if (error === 3) {
              throw vscode.FileSystemError.FileExists(uri);
            } else
              if (error === 4) {
                throw vscode.FileSystemError.NoPermissions(uri);
              }

      }).catch(reject);
    });
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(ReadFileCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); }); //name

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          let fileSize = b.readUInt32LE(offset); offset += 4; //number of bytes

          resolve(b.subarray(offset, offset + fileSize));
        } else {
          throw vscode.FileSystemError.FileNotFound(uri);
        }

      }).catch(reject);
    });
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void | Thenable<void> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length + 1 + 1 + 4 + content.length;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(WriteFileCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); });  //name
    buffer.writeUInt8(options.create ? 1 : 0, offset); offset += 1; //create
    buffer.writeUInt8(options.overwrite ? 1 : 0, offset); offset += 1; //overwrite
    buffer.writeUInt32LE(content.length, offset); offset += 4; //length of content
    buffer.fill(content, offset, offset + content.length); offset += content.length; //length of content

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          resolve();
        } else
          if (error === 1) {
            throw vscode.FileSystemError.FileNotFound(uri);
          } else
            if (error === 2) {
              throw vscode.FileSystemError.FileNotFound(uri);
            } else
              if (error === 3) {
                throw vscode.FileSystemError.FileExists(uri);
              } else
                if (error === 4) {
                  throw vscode.FileSystemError.NoPermissions(uri);
                }

      }).catch(reject);
    });
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    let utf8Encode = new TextEncoder();
    let nameBytes = utf8Encode.encode(uri.path);

    let packetSize = 1 + 4 + nameBytes.length + 1;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(DeleteCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(nameBytes.length, offset); offset += 4; //length of name
    nameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); });  //name
    buffer.writeUInt8(options.recursive ? 1 : 0, offset); offset += 1; //recursive

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          resolve();
        } else
          if (error === 1) {
            throw vscode.FileSystemError.FileNotFound(uri);
          } else
            if (error === 4) {
              throw vscode.FileSystemError.NoPermissions(uri);
            }

      }).catch(reject);
    });
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    let utf8Encode = new TextEncoder();
    let oldNameBytes = utf8Encode.encode(oldUri.path);
    let newNameBytes = utf8Encode.encode(newUri.path);

    let packetSize = 1 + 4 + oldNameBytes.length + 4 + newNameBytes.length + 1;
    let buffer = Buffer.allocUnsafe(packetSize);

    let offset = 0;
    buffer.writeUInt8(RenameCommand, offset); offset += 1; //opcode
    buffer.writeUInt32LE(oldNameBytes.length, offset); offset += 4; //length of name
    oldNameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); });  //name
    buffer.writeUInt32LE(newNameBytes.length, offset); offset += 4; //length of name
    newNameBytes.forEach((b) => { buffer.writeUInt8(b, offset++); });  //name
    buffer.writeUInt8(options.overwrite ? 1 : 0, offset); offset += 1; //overwrite

    return new Promise((resolve, reject) => {
      this._sendCommand(buffer).then((b: Buffer) => {

        let offset = 0;
        let error = b.readUInt8(offset); offset += 1; //error
        if (error === 0) {
          resolve();
        } else
          if (error === 1) {
            throw vscode.FileSystemError.FileNotFound(oldUri);
          } else
            if (error === 2) {
              throw vscode.FileSystemError.FileNotFound(newUri);
            } else
              if (error === 3) {
                throw vscode.FileSystemError.FileExists(newUri);
              } else
                if (error === 4) {
                  throw vscode.FileSystemError.NoPermissions(oldUri);
                }

      }).catch(reject);
    });
  }

  // copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
  //   throw new Error('Method not implemented.');
  // }
}