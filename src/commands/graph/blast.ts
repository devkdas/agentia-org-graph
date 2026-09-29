import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {resolve} from 'node:path'

function runAgentia(args: string[], timeoutMs = 120_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

interface Edge {
  from: string
  to: string
}

function nodeLabel(n: string, t: string): string {
  return `${t}:${n}`
}

function toMermaid(center: string, up: string[], down: string[]): string {
  const lines = ['flowchart TD']
  const id = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60) || 'node'
  const cid = id(`c_${center}`)
  lines.push(`    ${cid}["${center}"]`)
  lines.push(`    style ${cid} fill:#7C3AED,stroke:#fff,color:#fff`)
  up.slice(0, 25).forEach((u, i) => {
    const uid = id(`u${i}_${u}`)
    lines.push(`    ${uid}["${u}"] --> ${cid}`)
  })
  down.slice(0, 25).forEach((d, i) => {
    const did = id(`d${i}_${d}`)
    lines.push(`    ${cid} --> ${did}["${d}"]`)
  })
  return lines.join('\n')
}

export default class GraphBlast extends Command {
  static description =
    'Map the deployment blast radius of one metadata member. Read only.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ApexClass --name AccountHelper --source-credential-id a11 --source-org-id 00D --pipeline-id a0W',
    '<%= config.bin %> <%= command.id %> --type ApexClass --name AccountHelper --source-credential-id a11 --source-org-id 00D --pipeline-id a0W --format json',
  ]

  static flags = {
    type: Flags.string({char: 't', description: 'Metadata type, for example ApexClass.', required: true}),
    name: Flags.string({char: 'n', description: 'Metadata API name.', required: true}),
    'source-credential-id': Flags.string({description: 'Org credential ID.', required: true}),
    'source-org-id': Flags.string({description: 'Org ID.', required: true}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping the gateway call.', required: true}),
    format: Flags.string({description: 'Output artifact format.', options: ['mermaid', 'json'], default: 'mermaid'}),
    output: Flags.string({char: 'o', description: 'File path for the map artifact.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(GraphBlast)
    const type = flags.type as string
    const name = flags.name as string
    const sCred = flags['source-credential-id'] as string
    const sOrg = flags['source-org-id'] as string
    const pipeline = flags['pipeline-id'] as string
    const format = ((flags.format as string) ?? 'mermaid') as 'mermaid' | 'json'
    const output = (flags.output as string | undefined) ?? null
    const asJson = (flags.json as boolean) ?? false

    let deps: any[] = []
    try {
      const out = runAgentia(['cicd', 'metadata', 'dependency', 'list', '--metadata-type', type,
        '--metadata-name', name, '--source-credential-id', sCred, '--source-org-id', sOrg,
        '--pipeline-id', pipeline, '--json'])
      const parsed = JSON.parse(out)
      const r = parsed?.result ?? parsed
      deps = Array.isArray(r?.dependencies) ? r.dependencies : Array.isArray(r) ? r : []
    } catch (error: any) {
      const detail = `Dependency lookup failed: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const up = new Set<string>()
    const down = new Set<string>()
    for (const d of deps) {
      if (typeof d !== 'object' || d === null) continue
      const dn = typeof d.n === 'string' ? d.n : ''
      const dt = typeof d.t === 'string' ? d.t : ''
      const isCenter = dn === name && (dt === '' || dt === type)
      const push = (v: unknown, set: Set<string>, t: string): void => {
        if (typeof v === 'string' && v !== '') set.add(nodeLabel(v, t))
        else if (typeof v === 'object' && v !== null) {
          const rec = v as Record<string, unknown>
          const nn = typeof rec['n'] === 'string' ? (rec['n'] as string) : typeof rec['name'] === 'string' ? (rec['name'] as string) : ''
          const tt = typeof rec['t'] === 'string' ? (rec['t'] as string) : typeof rec['type'] === 'string' ? (rec['type'] as string) : t
          if (nn !== '') set.add(nodeLabel(nn, tt))
        }
      }
      const uList = Array.isArray(d.u) ? d.u : []
      const dList = Array.isArray(d.d) ? d.d : []
      if (isCenter || (dn !== '' && uList.length + dList.length === 0)) {
        if (!isCenter && dn !== '') {
          up.add(nodeLabel(dn, dt || type))
          continue
        }
        for (const u of uList) push(u, up, type)
        for (const dd of dList) push(dd, down, type)
      } else if (dn !== '') {
        up.add(nodeLabel(dn, dt || type))
      }
    }

    const center = nodeLabel(name, type)
    const upArr = [...up]
    const downArr = [...down]
    const artifact = format === 'mermaid'
      ? toMermaid(center, upArr, downArr)
      : JSON.stringify({center, upstream: upArr, downstream: downArr}, null, 2)

    let file: string | null = null
    if (output) {
      file = resolve(process.cwd(), output)
      writeFileSync(file, artifact, 'utf8')
    }

    const payload = {
      status: upArr.length + downArr.length > 0 ? 'mapped' : 'empty',
      center,
      upstreamCount: upArr.length,
      downstreamCount: downArr.length,
      upstream: upArr.slice(0, 25),
      downstream: downArr.slice(0, 25),
      file,
      note: upArr.length + downArr.length === 0 ? 'No dependencies returned. The member may not exist or may be isolated.' : null,
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      if (output) this.log(`Blast radius map written to ${file}.`)
      else this.log(artifact)
      this.log(`Upstream ${upArr.length}, downstream ${downArr.length} for ${center}.`)
    }
  }
}
