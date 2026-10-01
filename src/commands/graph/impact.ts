import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

function runAgentia(args: string[], timeoutMs = 60_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

function rowsOf(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return []
  const r = parsed?.result ?? parsed
  if (Array.isArray(r)) return r
  for (const key of ['data', 'builds', 'jobs', 'runs']) {
    if (Array.isArray((r as Record<string, unknown>)?.[key])) return (r as Record<string, unknown>)[key] as any[]
  }
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function findStatus(node: unknown, depth = 0): string | null {
  if (node == null || depth > 4) return null
  if (typeof node === 'string') {
    const v = node.trim()
    if (/^(completed|complete|success|succeeded|successful|passed|pass|failed|failure|error|errored|cancelled|canceled|aborted|timeout|timed.?out)/i.test(v)) return v
    return null
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findStatus(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const [key, value] of Object.entries(obj)) {
      if (/^(status|state|testresult)$/i.test(key) && typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    for (const value of Object.values(obj)) {
      const hit = findStatus(value, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

const RISK_TIERS: Array<{match: RegExp; tier: string; reason: string}> = [
  {match: /flow|validationrule|sharingrule|workflow/i, tier: 'high', reason: 'Automation runs on data change. Breakage is silent and broad.'},
  {match: /trigger/i, tier: 'high', reason: 'Executes on every record operation in scope.'},
  {match: /apexclass/i, tier: 'medium', reason: 'Direct callers break on signature change, logic otherwise contained.'},
  {match: /permission|profile/i, tier: 'high', reason: 'Access changes affect every user holding the grant.'},
  {match: /customobject|customfield/i, tier: 'medium', reason: 'Schema changes ripple to layouts, reports and code.'},
]

function tierFor(type: string): {tier: string; reason: string} {
  for (const t of RISK_TIERS) {
    if (t.match.test(type)) return {tier: t.tier, reason: t.reason}
  }
  return {tier: 'low', reason: 'No elevated risk pattern matched. Review normally.'}
}

export default class GraphImpact extends Command {
  static description =
    'Assess change impact: downstream risk tiers plus recent pipeline activity. Heuristic tiers, stated openly.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ApexClass --name CopadoTrailHelper --source-credential-id a11 --source-org-id 00D --pipeline-id a0W',
    '<%= config.bin %> <%= command.id %> --type ApexClass --name CopadoTrailHelper --source-credential-id a11 --source-org-id 00D --pipeline-id a0W --output-dir ./impact --json',
  ]

  static flags = {
    type: Flags.string({char: 't', description: 'Metadata type, for example ApexClass.', required: true}),
    name: Flags.string({char: 'n', description: 'Metadata API name.', required: true}),
    'source-credential-id': Flags.string({description: 'Org credential ID.', required: true}),
    'source-org-id': Flags.string({description: 'Org ID.', required: true}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping calls plus recent activity.', required: true}),
    'output-dir': Flags.string({char: 'o', description: 'Directory for the impact files.', default: './impact-report'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(GraphImpact)
    const type = flags.type as string
    const name = flags.name as string
    const sCred = flags['source-credential-id'] as string
    const sOrg = flags['source-org-id'] as string
    const pipeline = flags['pipeline-id'] as string
    const outDir = resolve(process.cwd(), (flags['output-dir'] as string) ?? './impact-report')
    const asJson = (flags.json as boolean) ?? false
    const notes: string[] = []

    let downstream: string[] = []
    let upstreamCount = 0
    try {
      const out = runAgentia(['cicd', 'metadata', 'dependency', 'list', '--metadata-type', type,
        '--metadata-name', name, '--source-credential-id', sCred, '--source-org-id', sOrg,
        '--pipeline-id', pipeline, '--json'])
      const parsed = JSON.parse(out)
      const r = parsed?.result ?? parsed
      const deps: any[] = Array.isArray(r?.dependencies) ? r.dependencies : []
      for (const d of deps) {
        if (typeof d !== 'object' || d === null) continue
        const items = [...(Array.isArray(d.d) ? d.d : []), ...(Array.isArray(d.u) ? d.u : [])]
        for (const item of items) {
          if (typeof item === 'string' && item !== '') downstream.push(item)
          else if (typeof item === 'object' && item !== null) {
            const rec = item as Record<string, unknown>
            const nn = typeof rec['n'] === 'string' ? (rec['n'] as string) : typeof rec['name'] === 'string' ? (rec['name'] as string) : ''
            const tt = typeof rec['t'] === 'string' ? (rec['t'] as string) : ''
            if (nn !== '') downstream.push(tt !== '' ? `${tt}:${nn}` : nn)
          }
        }
      }
      upstreamCount = downstream.length
      downstream = [...new Set(downstream)].slice(0, 50)
    } catch {
      notes.push('Dependency lookup failed. Impact covers pipeline activity only.')
    }

    let recentPromotions: Array<{name: string; status: string}> = []
    try {
      const rows = rowsOf(JSON.parse(runAgentia(['cicd', 'promotion', 'list', '--pipeline-id', pipeline, '--page-size', '10', '--json'])))
      recentPromotions = rows.slice(0, 10).map((p) => ({name: str(p.name) || str(p.id) || 'promotion', status: str(p.status) || 'unknown'}))
    } catch {
      notes.push('Recent promotion activity unreadable.')
    }

    const self = tierFor(type)
    const assessed = downstream.map((d) => {
      const t = tierFor(d.split(':')[0] ?? d)
      return {member: d, tier: t.tier, reason: t.reason}
    })
    const highest = assessed.some((a) => a.tier === 'high') || self.tier === 'high' ? 'high'
      : assessed.some((a) => a.tier === 'medium') || self.tier === 'medium' ? 'medium' : 'low'

    mkdirSync(outDir, {recursive: true})
    const stamp = new Date().toISOString().slice(0, 10)
    const payload = {
      status: 'assessed',
      center: `${type}:${name}`,
      selfTier: self,
      downstream: assessed,
      downstreamCount: assessed.length,
      recentPromotions,
      overall: `${highest} (heuristic tiers, review before acting)`,
      notes,
    }
    writeFileSync(join(outDir, `IMPACT-${stamp}.json`), JSON.stringify(payload, null, 2), 'utf8')

    const lines = [
      `# Impact assessment, ${type} ${name}`,
      '',
      `Generated ${new Date().toISOString()} by agentia graph impact.`,
      `Overall: ${highest} (heuristic tiers, review before acting).`,
      '',
      '## Downstream dependents',
      '',
      ...(assessed.length === 0 ? ['None returned. The member may be isolated or missing.']
        : assessed.map((a) => `- [${a.tier}] ${a.member}: ${a.reason}`)),
      '',
      '## Recent pipeline activity (context, not causation)',
      '',
      ...(recentPromotions.length === 0 ? ['None listed.']
        : recentPromotions.map((p) => `- ${p.name} [${p.status}]`)),
    ]
    if (notes.length > 0) {
      lines.push('', '## Notes', '')
      for (const n of notes) lines.push(`- ${n}`)
    }
    lines.push('')
    const mdFile = join(outDir, `IMPACT-${stamp}.md`)
    writeFileSync(mdFile, lines.join('\n'), 'utf8')

    if (asJson) {
      this.log(JSON.stringify({...payload, files: [mdFile]}, null, 2))
    } else {
      this.log(`Impact for ${type} ${name}: ${highest.toUpperCase()} across ${assessed.length} dependents, ${recentPromotions.length} recent promotions for context.`)
      this.log(`Files in ${outDir}. Tiers are heuristics. Review before acting.`)
    }
  }
}
