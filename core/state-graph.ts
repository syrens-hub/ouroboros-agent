export interface Checkpoint<TState> {
  nodeId: string;
  state: TState;
  visited: string[];
}

export class StateGraphMaxStepsError extends Error {
  constructor() {
    super("Maximum number of steps exceeded");
    this.name = "StateGraphMaxStepsError";
  }
}

export class StateGraphInterruptedError<TState> extends Error {
  readonly checkpoint: Checkpoint<TState>;

  constructor(checkpoint: Checkpoint<TState>) {
    super(`Execution interrupted at node '${checkpoint.nodeId}'`);
    this.name = "StateGraphInterruptedError";
    this.checkpoint = checkpoint;
  }
}

type NodeFn<TState> = (state: TState) => Promise<TState> | TState;

interface ConditionalEdge<TState> {
  fn: (state: TState) => string;
  mappings: Record<string, string>;
}

interface ParallelGroup<TState> {
  nodeIds: string[];
  mergeFn: (states: TState[]) => TState;
}

export class CompiledStateGraph<TState> {
  private nodes: ReadonlyMap<string, NodeFn<TState>>;
  private edges: ReadonlyMap<string, readonly string[]>;
  private conditionalEdges: ReadonlyMap<string, ConditionalEdge<TState>>;
  private parallelGroups: ReadonlyMap<string, ParallelGroup<TState>>;
  private nodeToParallelGroup: ReadonlyMap<string, string>;
  private interruptNodes: ReadonlySet<string>;
  private entryPoint: string;

  constructor(
    nodes: ReadonlyMap<string, NodeFn<TState>>,
    edges: ReadonlyMap<string, readonly string[]>,
    conditionalEdges: ReadonlyMap<string, ConditionalEdge<TState>>,
    parallelGroups: ReadonlyMap<string, ParallelGroup<TState>>,
    nodeToParallelGroup: ReadonlyMap<string, string>,
    interruptNodes: ReadonlySet<string>,
    entryPoint: string,
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.conditionalEdges = conditionalEdges;
    this.parallelGroups = parallelGroups;
    this.nodeToParallelGroup = nodeToParallelGroup;
    this.interruptNodes = interruptNodes;
    this.entryPoint = entryPoint;
  }

  async invoke(
    initialState: TState,
    opts?: { maxSteps?: number },
  ): Promise<TState> {
    let finalState = initialState;
    for await (const event of this.stream(initialState, opts)) {
      finalState = event.state;
    }
    return finalState;
  }

  async *stream(
    initialState: TState,
    opts?: { maxSteps?: number },
  ): AsyncGenerator<{ nodeId: string; state: TState }> {
    const maxSteps = opts?.maxSteps ?? 100;
    const queue: string[] = [this.entryPoint];
    const visited = new Set<string>();
    let state = initialState;
    let steps = 0;

    while (queue.length > 0) {
      if (steps >= maxSteps) {
        throw new StateGraphMaxStepsError();
      }

      const nodeId = queue.shift()!;

      const parallelGroupId = this.nodeToParallelGroup.get(nodeId);
      if (parallelGroupId) {
        const group = this.parallelGroups.get(parallelGroupId)!;
        const groupNodeIdsSet = new Set(group.nodeIds);

        for (let i = queue.length - 1; i >= 0; i--) {
          if (groupNodeIdsSet.has(queue[i]!)) {
            queue.splice(i, 1);
          }
        }

        const results = await Promise.all(
          group.nodeIds.map((id) => {
            const fn = this.nodes.get(id);
            if (!fn) {
              throw new Error(`Node '${id}' not found`);
            }
            return fn(state);
          }),
        );

        state = group.mergeFn(results);

        for (const id of group.nodeIds) {
          visited.add(id);
          yield { nodeId: id, state };
        }

        steps += group.nodeIds.length;

        const nextNodes = new Set<string>();
        for (const id of group.nodeIds) {
          for (const target of this.edges.get(id) ?? []) {
            if (!groupNodeIdsSet.has(target)) {
              nextNodes.add(target);
            }
          }
          const condEdge = this.conditionalEdges.get(id);
          if (condEdge) {
            const target = condEdge.mappings[condEdge.fn(state)];
            if (target && !groupNodeIdsSet.has(target)) {
              nextNodes.add(target);
            }
          }
        }

        for (const target of nextNodes) {
          if (!queue.includes(target)) {
            queue.push(target);
          }
        }

        continue;
      }

      if (this.interruptNodes.has(nodeId)) {
        throw new StateGraphInterruptedError({
          nodeId,
          state,
          visited: Array.from(visited),
        });
      }

      const fn = this.nodes.get(nodeId);
      if (!fn) {
        throw new Error(`Node '${nodeId}' not found`);
      }

      state = await fn(state);
      visited.add(nodeId);
      steps++;

      yield { nodeId, state };

      for (const target of this.edges.get(nodeId) ?? []) {
        if (!queue.includes(target)) {
          queue.push(target);
        }
      }

      const condEdge = this.conditionalEdges.get(nodeId);
      if (condEdge) {
        const target = condEdge.mappings[condEdge.fn(state)];
        if (target && !queue.includes(target)) {
          queue.push(target);
        }
      }
    }
  }

  async resume(
    checkpoint: Checkpoint<TState>,
    opts?: { maxSteps?: number },
  ): Promise<TState> {
    const maxSteps = opts?.maxSteps ?? 100;
    const queue: string[] = [checkpoint.nodeId];
    const visited = new Set<string>(checkpoint.visited);
    let state = checkpoint.state;
    let steps = 0;
    let isFirstNode = true;

    while (queue.length > 0) {
      if (steps >= maxSteps) {
        throw new StateGraphMaxStepsError();
      }

      const nodeId = queue.shift()!;

      const parallelGroupId = this.nodeToParallelGroup.get(nodeId);
      if (parallelGroupId) {
        const group = this.parallelGroups.get(parallelGroupId)!;
        const groupNodeIdsSet = new Set(group.nodeIds);

        for (let i = queue.length - 1; i >= 0; i--) {
          if (groupNodeIdsSet.has(queue[i]!)) {
            queue.splice(i, 1);
          }
        }

        const results = await Promise.all(
          group.nodeIds.map((id) => {
            const fn = this.nodes.get(id);
            if (!fn) {
              throw new Error(`Node '${id}' not found`);
            }
            return fn(state);
          }),
        );

        state = group.mergeFn(results);

        for (const id of group.nodeIds) {
          visited.add(id);
        }

        steps += group.nodeIds.length;

        const nextNodes = new Set<string>();
        for (const id of group.nodeIds) {
          for (const target of this.edges.get(id) ?? []) {
            if (!groupNodeIdsSet.has(target)) {
              nextNodes.add(target);
            }
          }
          const condEdge = this.conditionalEdges.get(id);
          if (condEdge) {
            const target = condEdge.mappings[condEdge.fn(state)];
            if (target && !groupNodeIdsSet.has(target)) {
              nextNodes.add(target);
            }
          }
        }

        for (const target of nextNodes) {
          if (!queue.includes(target)) {
            queue.push(target);
          }
        }

        isFirstNode = false;
        continue;
      }

      if (!isFirstNode && this.interruptNodes.has(nodeId)) {
        throw new StateGraphInterruptedError({
          nodeId,
          state,
          visited: Array.from(visited),
        });
      }
      isFirstNode = false;

      const fn = this.nodes.get(nodeId);
      if (!fn) {
        throw new Error(`Node '${nodeId}' not found`);
      }

      state = await fn(state);
      visited.add(nodeId);
      steps++;

      for (const target of this.edges.get(nodeId) ?? []) {
        if (!queue.includes(target)) {
          queue.push(target);
        }
      }

      const condEdge = this.conditionalEdges.get(nodeId);
      if (condEdge) {
        const target = condEdge.mappings[condEdge.fn(state)];
        if (target && !queue.includes(target)) {
          queue.push(target);
        }
      }
    }

    return state;
  }
}

export class StateGraph<TState> {
  private nodes = new Map<string, NodeFn<TState>>();
  private edges = new Map<string, string[]>();
  private conditionalEdges = new Map<string, ConditionalEdge<TState>>();
  private parallelGroups = new Map<string, ParallelGroup<TState>>();
  private nodeToParallelGroup = new Map<string, string>();
  private interruptNodes = new Set<string>();
  private nodeOrder: string[] = [];

  addNode(id: string, fn: NodeFn<TState>): this {
    this.nodes.set(id, fn);
    if (!this.nodeOrder.includes(id)) {
      this.nodeOrder.push(id);
    }
    return this;
  }

  addEdge(from: string, to: string): this {
    const existing = this.edges.get(from);
    if (existing) {
      existing.push(to);
    } else {
      this.edges.set(from, [to]);
    }
    return this;
  }

  addConditionalEdge(
    from: string,
    fn: (state: TState) => string,
    mappings: Record<string, string>,
  ): this {
    this.conditionalEdges.set(from, { fn, mappings });
    return this;
  }

  addParallel(
    nodeIds: string[],
    mergeFn: (states: TState[]) => TState,
  ): string {
    const groupId = `__parallel:${nodeIds.join(",")}`;
    this.parallelGroups.set(groupId, { nodeIds, mergeFn });
    for (const nodeId of nodeIds) {
      this.nodeToParallelGroup.set(nodeId, groupId);
    }
    return groupId;
  }

  interruptAt(nodeId: string): this {
    this.interruptNodes.add(nodeId);
    return this;
  }

  async resume(
    checkpoint: Checkpoint<TState>,
    opts?: { maxSteps?: number },
  ): Promise<TState> {
    return this.compile().resume(checkpoint, opts);
  }

  compile(): CompiledStateGraph<TState> {
    const entryPoint = this.nodes.has("__start__")
      ? "__start__"
      : this.nodeOrder[0];
    if (!entryPoint) {
      throw new Error("Graph has no nodes");
    }
    return new CompiledStateGraph(
      new Map(this.nodes),
      new Map(this.edges),
      new Map(this.conditionalEdges),
      new Map(this.parallelGroups),
      new Map(this.nodeToParallelGroup),
      new Set(this.interruptNodes),
      entryPoint,
    );
  }
}
