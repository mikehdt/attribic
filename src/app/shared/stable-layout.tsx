'use client';

import { GpuIcon } from 'lucide-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { GlobalMenu } from '@/app/shared/global-menu';
import { ShelfInfoRow, TopShelfFrame } from '@/app/shared/shelf';
import { TaggingBottomShelf } from '@/app/tagging/components/bottom-shelf/tagging-bottom-shelf';
import { TaggingTopShelf } from '@/app/tagging/components/top-shelf/tagging-top-shelf';
import { TrainingTopShelf } from '@/app/training/components/training-top-shelf';

import { selectFilteredAssetsCount } from '../store/assets';
import { selectPaginationSize } from '../store/filters';
import { useAppSelector } from '../store/hooks';
import { Button } from './button';
import { ToolbarDivider } from './toolbar-divider';

export const StableLayout = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();

  const project = params.project as string | undefined;
  const currentPage = parseInt(params.page as string, 10) || 1;

  const isTagging = pathname.startsWith('/tagging');
  const isTraining = pathname.startsWith('/training');
  const isProjectList = pathname === '/';
  const basePath = project
    ? `/tagging/${encodeURIComponent(project)}`
    : '/tagging';

  const paginationSize = useAppSelector(selectPaginationSize);
  const filteredCount = useAppSelector(selectFilteredAssetsCount);

  // Calculate total pages based on filtered results
  const totalPages = useMemo(() => {
    if (paginationSize === -1) return 1; // -1 is PaginationSize.ALL
    return Math.max(1, Math.ceil(filteredCount / paginationSize));
  }, [filteredCount, paginationSize]);

  // Effect to redirect if current page is out of bounds after filter change
  useEffect(() => {
    if (isTagging && currentPage > totalPages) {
      router.push(`${basePath}/1`);
    }
  }, [isTagging, currentPage, totalPages, router, basePath]);

  const mainPadding = isTagging
    ? 'pt-24 pb-16'
    : isTraining
      ? 'pt-24 pb-16'
      : isProjectList
        ? 'pt-14'
        : '';

  return (
    <main
      className={`relative mx-auto min-h-screen max-w-400 px-4 ${mainPadding}`}
    >
      {isTagging && <TaggingTopShelf currentPage={currentPage} />}
      {isTraining && <TrainingTopShelf />}
      {isProjectList && (
        <TopShelfFrame>
          <ShelfInfoRow>
            <GlobalMenu />

            <ToolbarDivider />

            <div className="mr-auto flex">
              <Button
                size="xs"
                width="md"
                variant="ghost"
                onClick={() => router.push('/training')}
              >
                <GpuIcon /> Lora Training
              </Button>
            </div>
          </ShelfInfoRow>
        </TopShelfFrame>
      )}
      {children}
      {isTagging && (
        <TaggingBottomShelf
          currentPage={currentPage}
          totalPages={totalPages}
          basePath={basePath}
        />
      )}
    </main>
  );
};
