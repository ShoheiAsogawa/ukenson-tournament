type ConflictResult = {
  ok: false
  error: 'conflict'
  currentUpdatedAt: string | null
  payload?: Record<string, unknown> | null
}

type WriteOk = {
  ok: true
  updatedAt: string
}

/** Conditionally update tournament_states so concurrent writers cannot silently clobber. */
export async function writeTournamentStateAtomic(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  {
    id,
    payload,
    expectedUpdatedAt,
    includePayloadOnConflict = false,
  }: {
    id: string
    payload: Record<string, unknown>
    expectedUpdatedAt?: string | null
    includePayloadOnConflict?: boolean
  },
): Promise<WriteOk | ConflictResult | { ok: false; error: string }> {
  const updatedAt = new Date().toISOString()
  const nextPayload = { ...payload, updatedAt }

  if (expectedUpdatedAt) {
    const { data: written, error } = await supabase
      .from('tournament_states')
      .update({ payload: nextPayload, updated_at: updatedAt })
      .eq('id', id)
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
      .maybeSingle()

    if (error) return { ok: false, error: error.message }
    if (written?.updated_at) return { ok: true, updatedAt: written.updated_at }

    const selectColumns = includePayloadOnConflict ? 'payload, updated_at' : 'updated_at'
    const { data: current, error: readError } = await supabase
      .from('tournament_states')
      .select(selectColumns)
      .eq('id', id)
      .maybeSingle()

    if (readError) return { ok: false, error: readError.message }
    if (!current) {
      const { error: insertError } = await supabase
        .from('tournament_states')
        .insert({ id, payload: nextPayload, updated_at: updatedAt })
      if (insertError) return { ok: false, error: insertError.message }
      return { ok: true, updatedAt }
    }

    return {
      ok: false,
      error: 'conflict',
      currentUpdatedAt: current.updated_at || null,
      ...(includePayloadOnConflict
        ? { payload: (current.payload as Record<string, unknown>) || null }
        : {}),
    }
  }

  const { error } = await supabase
    .from('tournament_states')
    .upsert({ id, payload: nextPayload, updated_at: updatedAt })

  if (error) return { ok: false, error: error.message }
  return { ok: true, updatedAt }
}
