import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Project } from '@/types';

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  saveProject: (project: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createNewProject: (p: Project) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
}

export function useProjects(userId: string | null): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  // 첫 로드: DB에서 프로젝트 목록 가져오기
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

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

        setProjects(loaded);
      } catch (e: any) {
        console.error('Failed to load projects:', e?.message || e?.code || JSON.stringify(e));
      } finally {
        setLoading(false);
      }
    }

    loadProjects();
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

  return { projects, loading, saveProject, deleteProject, createNewProject, reorderProjects };
}
