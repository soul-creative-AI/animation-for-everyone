import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Project } from '@/types';

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  ready: boolean;  // 현재 userId의 프로젝트 로드가 끝나 projects가 실제 상태를 반영하는가
  saveProject: (project: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createNewProject: (p: Project) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
}

export function useProjects(userId: string | null): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  // ready: 이 userId에 대한 로드가 "완료"됐는지. projects가 []여도 로드 완료 후의 []인지
  // 아직 로드 전의 []인지 구별하기 위한 신호 — 자동생성이 로드 전 빈 목록에 오작동하지 않도록.
  const [ready, setReady] = useState(false);
  const supabase = createClient();

  // 첫 로드: DB에서 프로젝트 목록 가져오기
  useEffect(() => {
    // userId가 바뀌면 이전 로드 결과는 무효 — 로드 완료 신호부터 내린다
    setReady(false);
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    let cancelled = false;  // userId가 다시 바뀌면 이전 요청 결과는 버림(경합 방지)
    async function loadProjects() {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, title, created_at, updated_at, sort_order, data')
          .eq('user_id', userId)
          .order('sort_order', { ascending: true });

        if (error) throw error;

        const loaded: Project[] = (data || []).map((row) => ({
          ...(row.data as any),
          id: row.id,
          title: row.title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          sortOrder: row.sort_order ?? 0,
        }));

        if (!cancelled) setProjects(loaded);
      } catch (e: any) {
        console.error('Failed to load projects:', e?.message || e?.code || JSON.stringify(e));
      } finally {
        // 로드가 끝나야(성공/실패 무관) ready를 올려 "이 목록이 확정됐다"고 알린다
        if (!cancelled) { setLoading(false); setReady(true); }
      }
    }

    loadProjects();
    return () => { cancelled = true; };
  }, [userId]);

  async function saveProject(project: Project) {
    if (!userId) throw new Error('Not authenticated');

    const { id, title, createdAt, updatedAt, sortOrder, ...data } = project;

    // 새 프로젝트면 맨 뒤 순서로 배정
    const isNew = !projects.find((p) => p.id === id);
    const nextSortOrder = isNew
      ? (projects.length > 0 ? Math.max(...projects.map((p) => p.sortOrder)) + 1 : 0)
      : sortOrder;

    const { error } = await supabase
      .from('projects')
      .upsert({
        id,
        user_id: userId,
        title,
        created_at: createdAt,
        updated_at: new Date().toISOString(),
        sort_order: nextSortOrder,
        data,
      });

    if (error) throw error;

    const saved = { ...project, updatedAt: new Date().toISOString(), sortOrder: nextSortOrder };
    setProjects((prev) =>
      isNew ? [...prev, saved] : prev.map((p) => (p.id === id ? saved : p))
    );
  }

  async function deleteProject(id: string) {
    if (!userId) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  async function createNewProject(p: Project) {
    if (!userId) throw new Error('Not authenticated');
    await saveProject(p);
  }

  // 드래그로 바뀐 순서를 받아서 sort_order를 다시 매기고 DB에 반영
  async function reorderProjects(orderedIds: string[]) {
    if (!userId) throw new Error('Not authenticated');

    const reordered = orderedIds
      .map((id, index) => {
        const p = projects.find((x) => x.id === id);
        return p ? { ...p, sortOrder: index } : null;
      })
      .filter((p): p is Project => p !== null);

    // 화면은 즉시 반영
    setProjects(reordered);

    // DB는 백그라운드로 반영
    const { error } = await supabase.from('projects').upsert(
      reordered.map((p) => ({
        id: p.id,
        user_id: userId,
        sort_order: p.sortOrder,
      }))
    );

    if (error) {
      console.error('Failed to save order:', error);
      throw error;
    }
  }

  return { projects, loading, ready, saveProject, deleteProject, createNewProject, reorderProjects };
}
