'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';

import { AssetGallery } from '../../views/asset-gallery/asset-gallery';

export default function TaggingPage() {
  const params = useParams();
  const currentPage = parseInt(params.page as string, 10) || 1;

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentPage]);

  return <AssetGallery currentPage={currentPage} />;
}
