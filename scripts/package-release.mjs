import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const release = join(root, 'release');
const directoryName = 'obsidian-extraboard';
const pluginDirectory = join(release, directoryName);
const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const archive = join(release, `${directoryName}-${version}.zip`);
const files = ['main.js', 'manifest.json', 'styles.css'];

function crc32(data) {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function zipEntry(name, data, offset) {
	const nameBytes = Buffer.from(name);
	const compressed = data.length === 0 ? data : deflateRawSync(data);
	const method = data.length === 0 ? 0 : 8;
	const checksum = crc32(data);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0, 6);
	local.writeUInt16LE(method, 8);
	local.writeUInt16LE(0, 10);
	local.writeUInt16LE(0, 12);
	local.writeUInt32LE(checksum, 14);
	local.writeUInt32LE(compressed.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	local.writeUInt16LE(0, 28);

	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0, 8);
	central.writeUInt16LE(method, 10);
	central.writeUInt16LE(0, 12);
	central.writeUInt16LE(0, 14);
	central.writeUInt32LE(checksum, 16);
	central.writeUInt32LE(compressed.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	central.writeUInt16LE(0, 30);
	central.writeUInt16LE(0, 32);
	central.writeUInt16LE(0, 34);
	central.writeUInt16LE(0, 36);
	central.writeUInt32LE(0, 38);
	central.writeUInt32LE(offset, 42);

	return { local: Buffer.concat([local, nameBytes, compressed]), central: Buffer.concat([central, nameBytes]) };
}

function createZip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [name, data] of entries) {
		const entry = zipEntry(name, data, offset);
		locals.push(entry.local);
		centrals.push(entry.central);
		offset += entry.local.length;
	}
	const central = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(central.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);
	return Buffer.concat([...locals, central, end]);
}

for (const file of files) {
	if (!existsSync(join(dist, file))) {
		throw new Error(`Missing release file: dist/${file}. Run npm run build first.`);
	}
}

mkdirSync(release, { recursive: true });
rmSync(pluginDirectory, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(pluginDirectory);

for (const file of files) {
	cpSync(join(dist, file), join(pluginDirectory, file));
}

const entries = [
	[`${directoryName}/`, Buffer.alloc(0)],
	...files.map((file) => [`${directoryName}/${file}`, readFileSync(join(pluginDirectory, file))]),
];
writeFileSync(archive, createZip(entries));
console.log(`Created ${archive}`);
