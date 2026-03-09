#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const version = args.version || packageJson.version;
const sha256 = args.sha256;
const outputPath = path.resolve(rootDir, args.output || 'packaging/homebrew-tap/Formula/collabmd.rb');
const owner = args.owner || 'andes90';
const repo = args.repo || packageJson.name;

if (!version) {
  throw new Error('Missing version. Pass --version or set package.json version.');
}

if (!sha256) {
  throw new Error('Missing sha256. Pass --sha256 <checksum>.');
}

if (!/^[a-f0-9]{64}$/i.test(sha256)) {
  throw new Error(`Invalid sha256: ${sha256}`);
}

if (version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, but --version was ${version}.`,
  );
}

const className = toFormulaClassName(packageJson.name);
const formula = `class ${className} < Formula
  desc "Collaborative markdown vault server"
  homepage "https://github.com/${owner}/${repo}"
  url "https://github.com/${owner}/${repo}/archive/refs/tags/v${version}.tar.gz"
  sha256 "${sha256}"
  license "${packageJson.license}"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/${packageJson.name}"
  end

  test do
    require "timeout"

    (testpath/"vault").mkpath
    (testpath/"vault/test.md").write("# Hello from Homebrew\\n")

    port = free_port
    log_path = testpath/"collabmd.log"
    pid = spawn(
      bin/"${packageJson.name}",
      testpath/"vault",
      "--no-tunnel",
      "--host", "127.0.0.1",
      "--port", port.to_s,
      out: log_path,
      err: log_path
    )

    output = nil

    Timeout.timeout(15) do
      loop do
        begin
          output = shell_output("curl -fsS http://127.0.0.1:#{port}/health").strip
          break if output == "ok"
        rescue ErrorDuringExecution
          sleep 1
        else
          sleep 1 if output != "ok"
        end
      end
    end

    assert_equal "ok", output
  ensure
    begin
      Process.kill("TERM", pid)
    rescue Errno::ESRCH
      nil
    end

    begin
      Process.wait(pid)
    rescue Errno::ECHILD
      nil
    end
  end
end
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, formula);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function toFormulaClassName(name) {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
