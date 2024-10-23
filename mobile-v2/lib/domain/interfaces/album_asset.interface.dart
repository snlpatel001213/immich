import 'dart:async';

import 'package:immich_mobile/domain/models/asset.model.dart';

abstract interface class IAlbumToAssetRepository {
  /// Link a list of assetIds to the given albumId
  Future<bool> addAssetIds(int albumId, Iterable<int> assetIds);

  /// Returns assets that are only part of the given album and nothing else
  Future<List<int>> getAssetIdsOnlyInAlbum(int albumId);

  /// Returns the assets for the given [albumId]
  Future<List<Asset>> getAssetsForAlbum(int albumId);

  /// Removes album with the given [albumId]
  Future<void> deleteAlbumId(int albumId);

  /// Removes all album to asset mappings
  Future<void> deleteAll();
}