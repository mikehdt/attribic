import sharp from 'sharp';

// libvips keeps up to 20 file descriptors open after an operation resolves, as
// a cache. On Windows those handles lock the image *and its parent folder*
// against rename/move/delete until the cache evicts them or the Node process
// exits — so scanning a dataset folder leaves it locked long after the scan
// finished. Disable the fd cache; the memory and operation caches (the ones
// that actually pay for themselves here) stay on.
sharp.cache({ files: 0 });

export { sharp };
