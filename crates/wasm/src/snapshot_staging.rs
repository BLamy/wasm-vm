//! Bounded ownership for a streamed resume container; never mutates the guest.
pub(crate) const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024 * 1024;
pub(crate) const MAX_COPY_BYTES: usize = 256 * 1024;

#[derive(Debug)]
pub(crate) struct SnapshotStaging {
    bytes: Vec<u8>,
    expected: usize,
}
impl SnapshotStaging {
    pub(crate) fn new(expected: usize) -> Result<Self, &'static str> {
        if !(84..=MAX_SNAPSHOT_BYTES).contains(&expected) {
            return Err("snapshot staging size must be between 84 bytes and 1 GiB");
        }
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(expected)
            .map_err(|_| "cannot allocate snapshot staging buffer")?;
        Ok(Self { bytes, expected })
    }
    pub(crate) fn append_with(
        &mut self,
        length: usize,
        copy: impl FnOnce(&mut [u8]),
    ) -> Result<(), &'static str> {
        if length == 0 || length > MAX_COPY_BYTES {
            return Err("snapshot staging chunk must be between 1 byte and 256 KiB");
        }
        let end = self
            .bytes
            .len()
            .checked_add(length)
            .filter(|n| *n <= self.expected)
            .ok_or("snapshot staging exceeds declared size")?;
        let start = self.bytes.len();
        self.bytes.resize(end, 0);
        copy(&mut self.bytes[start..end]);
        Ok(())
    }
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub(crate) fn finish(self) -> Result<Vec<u8>, &'static str> {
        if self.bytes.len() != self.expected {
            return Err("snapshot staging is incomplete");
        }
        Ok(self.bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_staging_bounds_and_ownership() {
        assert!(SnapshotStaging::new(0).is_err());
        assert!(SnapshotStaging::new(83).is_err());
        assert!(SnapshotStaging::new(MAX_SNAPSHOT_BYTES + 1).is_err());
        let mut staging = SnapshotStaging::new(84).unwrap();
        let pointer = staging.bytes.as_ptr();
        assert!(
            staging
                .append_with(0, |_| panic!("must reject before copying"))
                .is_err()
        );
        assert!(
            staging
                .append_with(MAX_COPY_BYTES + 1, |_| panic!("must reject before copying"))
                .is_err()
        );
        assert!(
            staging
                .append_with(85, |_| panic!("must reject before copying"))
                .is_err()
        );
        staging
            .append_with(41, |out| out.copy_from_slice(&[19; 41]))
            .unwrap();
        staging
            .append_with(43, |out| out.copy_from_slice(&[71; 43]))
            .unwrap();
        assert_eq!(staging.bytes().len(), 84);
        assert!(
            staging
                .append_with(1, |_| panic!("must reject before copying"))
                .is_err()
        );
        let bytes = staging.finish().unwrap();
        assert_eq!(
            pointer,
            bytes.as_ptr(),
            "finish transfers ownership without copying"
        );
        assert_eq!(bytes, [vec![19; 41], vec![71; 43]].concat());
        assert!(SnapshotStaging::new(84).unwrap().finish().is_err());
    }
}
