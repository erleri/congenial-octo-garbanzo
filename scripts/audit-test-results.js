import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Metadata guard, not another set of product tests. This detects exact
// redundancy; semantic ownership still requires review against the test map.
export function auditTestResults(report, sources) {
  const identities = new Map(), bodies = new Map(), tautologies = []
  let declarations = 0
  function normalized(text) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text)
    const tokens = []
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push(scanner.getTokenText())
    return tokens.join(' ')
  }
  for (const file of report.testResults) {
    const relative = path.relative(process.cwd(), file.name).replaceAll('\\', '/')
    for (const result of file.assertionResults) {
      const identity = `${relative}: ${result.fullName}`
      identities.set(identity, (identities.get(identity) ?? 0) + 1)
    }
    const source = ts.createSourceFile(file.name, sources[file.name], ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const title = node.arguments[0], callback = node.arguments.at(-1)
        if (/^(it|test)(\.|\()/.test(node.expression.getText(source) + '(') && title && ts.isStringLiteralLike(title) &&
            callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          declarations++
          const body = normalized(callback.getText(source))
          const hash = createHash('sha256').update(body).digest('hex')
          const entry = `${relative}: ${title.text}`
          bodies.set(hash, [...(bodies.get(hash) ?? []), entry])
        }
        if (ts.isPropertyAccessExpression(node.expression) && ['toBe', 'toEqual', 'toStrictEqual'].includes(node.expression.name.text)) {
          const receiver = node.expression.expression
          if (ts.isCallExpression(receiver) && receiver.expression.getText(source) === 'expect' && receiver.arguments[0] && node.arguments[0] &&
              normalized(receiver.arguments[0].getText(source)) === normalized(node.arguments[0].getText(source))) {
            tautologies.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const duplicateNames = [...identities].filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }))
  const identicalBodies = [...bodies.values()].filter(group => group.length > 1)
  return {
    files: report.testResults.length, declaredTests: declarations, executedCases: report.numTotalTests,
    parameterExpansions: report.numTotalTests - declarations,
    duplicateNames, identicalBodies, tautologies,
    limitations: 'Exact metadata/source audit only; does not prove semantic uniqueness or real AI quality.',
  }
}

async function main() {
  if (process.argv[2] === '--self-test') {
    const sample = (source, names) => auditTestResults({
      numTotalTests: names.length,
      testResults: [{ name: 'audit-fixture.test.ts', assertionResults: names.map(fullName => ({ fullName })) }],
    }, { 'audit-fixture.test.ts': source })
    assert.equal(sample("it('one', () => expect(value).toBe(1))", ['same', 'same']).duplicateNames.length, 1)
    assert.equal(sample("it('one', () => expect(value).toBe(1)); it('two', () => expect(value).toBe(1))", ['one', 'two']).identicalBodies.length, 1)
    assert.equal(sample("it('one', () => expect(value).toEqual(value))", ['one']).tautologies.length, 1)
    const distinct = sample("it.each([1,2])('case %s', value => expect(value).toBeGreaterThan(0))", ['case 1', 'case 2'])
    assert.deepEqual([distinct.declaredTests, distinct.executedCases, distinct.parameterExpansions], [1, 2, 1])
    assert.deepEqual([distinct.duplicateNames, distinct.identicalBodies, distinct.tautologies], [[], [], []])
    console.log('Test inventory guard: 4 self-checks passed (not product test cases).')
    return
  }
  const resultPath = process.argv[2] ?? '.local-reports/private/unit-tests.json'
  const report = JSON.parse(await fs.readFile(resultPath, 'utf8'))
  const sources = Object.fromEntries(await Promise.all(report.testResults.map(async file => [file.name, await fs.readFile(file.name, 'utf8')])))
  const summary = auditTestResults(report, sources)
  console.log(JSON.stringify(summary, null, 2))
  await fs.writeFile(path.join(path.dirname(resultPath), 'test-inventory.json'), JSON.stringify(summary, null, 2))
  if (summary.duplicateNames.length || summary.identicalBodies.length || summary.tautologies.length) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
