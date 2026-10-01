import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'

function runAgentia(args: string[], timeoutMs = 120_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

function rowsOf(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return []
  const r = parsed?.result ?? parsed
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.data)) return r.data
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

export default class GraphOrphans extends Command {
  static description =
    'Find metadata members with zero tracked dependencies. Cleanup candidates for review, never auto delete.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ApexClass --source-credential-id a11 --source-org-id 00D --pipeline-id a0W',
    '<%= config.bin %> <%= command.id %> --type ApexClass --member CopadoTrailHelper --source-credential-id a11 --source-org-id 00D --pipeline-id a0W --json',
  ]

  static flags = {
    type: Flags.string({char: 't', description: 'Metadata type scanned, for example ApexClass.', required: true}),
    member: Flags.string({char: 'm', description: 'Single member name to check instead of scanning.'}),
    'source-credential-id': Flags.string({description: 'Org credential ID.', required: true}),
    'source-org-id': Flags.string({description: 'Org ID.', required: true}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping calls.', required: true}),
    limit: Flags.integer({char: 'n', description: 'Members scanned at most.', default: 20}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(GraphOrphans)
    const type = flags.type as string
    const single = (flags.member as string | undefined) ?? null
    const sCred = flags['source-credential-id'] as string
    const sOrg = flags['source-org-id'] as string
    const pipeline = flags['pipeline-id'] as string
    const limit = Math.max(1, Math.min(100, (flags.limit as number) ?? 20))
    const asJson = (flags.json as boolean) ?? false
    const notes: string[] = []

    let names: string[] = []
    if (single) {
      names = [single]
    } else {
      try {
        const rows = rowsOf(JSON.parse(runAgentia(['cicd', 'metadata', 'list',
          '--metadata-types', type, '--limit', String(limit),
          '--source-credential-id', sCred, '--source-org-id', sOrg, '--pipeline-id', pipeline, '--json'])))
        names = rows.map((r) => str(r?.name || r?.apiName)).filter((n) => n !== '').slice(0, limit)
      } catch (error: any) {
        const detail = `Member listing failed: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
      if (names.length === 0) {
        const detail = 'No members of this type found to scan.'
        if (asJson) this.log(JSON.stringify({status: 'complete', orphans: [], detail}, null, 2))
        else this.log(detail)
        return
      }
    }

    const orphans: string[] = []
    const connected: Array<{member: string; edges: number}> = []
    for (const name of names) {
      try {
        const out = runAgentia(['cicd', 'metadata', 'dependency', 'list', '--metadata-type', type,
          '--metadata-name', name, '--source-credential-id', sCred, '--source-org-id', sOrg,
          '--pipeline-id', pipeline, '--json'])
        const parsed: any = JSON.parse(out)
        const r = parsed?.result ?? parsed
        const deps: any[] = Array.isArray(r?.dependencies) ? r.dependencies : []
        let edges = 0
        for (const d of deps) {
          if (typeof d === 'object' && d !== null) {
            if (Array.isArray(d.u)) edges += d.u.length
            if (Array.isArray(d.d)) edges += d.d.length
          }
        }
        if (edges === 0) orphans.push(name)
        else connected.push({member: name, edges})
      } catch {
        notes.push(`${name} lookup failed and was excluded, never assumed orphan.`)
      }
    }

    const payload = {
      status: 'complete',
      type,
      scanned: names.length,
      orphans,
      connectedCount: connected.length,
      notes: [...notes, 'Orphan means zero tracked dependencies, not proven unused. Dynamic references stay invisible. Review before deleting anything.'],
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`Orphan scan for ${type}: ${orphans.length} candidates out of ${names.length} scanned, ${connected.length} connected.`)
      for (const o of orphans.slice(0, 20)) this.log(`  candidate: ${o}`)
      this.log('Candidates for review, never auto delete. Dynamic references stay invisible to this scan.')
    }
  }
}
