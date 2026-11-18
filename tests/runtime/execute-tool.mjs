// Drive the native executor with the same raw tool-call shape as a model step.
export async function executeTool(tools, { name, arguments: args, callId, signal }) {
  const batch = await tools.execute({
    calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
    signal,
  })
  const [outcome] = batch.results
  if (outcome?.callId !== callId) throw new Error('Missing tool result for ' + callId)
  return outcome.result
}
