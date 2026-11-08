import { describe, expect, it } from 'vitest'
import { assertLocalDbTarget, isolatedConfig } from './local-release.js'
describe('isolated database target', () => {
  it('accepts only the separate report DB port on loopback', () => {
    expect(assertLocalDbTarget('postgresql://postgres:local@127.0.0.1:56322/postgres')).toEqual({ host: '127.0.0.1', port: 56322 })
    expect(() => assertLocalDbTarget('postgresql://postgres:local@127.0.0.1:55322/postgres')).toThrow('isolated_local_db_required')
    expect(() => assertLocalDbTarget('postgresql://postgres:local@db.project.supabase.co:56322/postgres')).toThrow('isolated_local_db_required')
  })
  it('isolates auxiliary ports and avoids sending local magic links to the old server', () => {
    const config = isolatedConfig('project_id = "existing"\nport = 55322\nport = 54323\nport = 54324\ninspector_port = 8083\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = ["https://127.0.0.1:3000"]')
    expect(config).toContain('port = 56323'); expect(config).toContain('port = 56324'); expect(config).toContain('inspector_port = 56328')
    expect(config).toContain('http://127.0.0.1:4175/local-experience.html'); expect(config).not.toContain(':3000')
    expect(config).toContain('"http://127.0.0.1:4176"')
    expect(config).toContain('"http://127.0.0.1:4177"')
    expect(config).not.toContain('http://**')
  })
})
