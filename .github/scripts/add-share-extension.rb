# Adds the "ShareExtension" target (Share → Goldstone) to the Xcode project.
# Run once; it's a no-op when the target already exists. Elie 10/18/26.
require 'xcodeproj'
path = File.expand_path('../../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
if project.targets.any? { |t| t.name == 'ShareExtension' }
  puts 'ShareExtension already in the project'
  exit 0
end
app = project.targets.find { |t| t.name == 'App' } or abort('App target missing')
deploy = app.build_configurations.first.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '15.0'
ext = project.new_target(:app_extension, 'ShareExtension', :ios, deploy, nil, :swift)
group = project.main_group.find_subpath('ShareExtension', true)
group.set_source_tree('<group>')
group.set_path('ShareExtension')
src = group.new_reference('ShareViewController.swift')
group.new_reference('Info.plist')
group.new_reference('ShareExtension.entitlements')
ext.add_file_references([src])
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.gpflips.app.ShareExtension'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['MARKETING_VERSION'] = app.build_configurations.first.build_settings['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['IPHONEOS_DEPLOYMENT_TARGET'] = deploy
end
app.add_dependency(ext)
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } || app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(ext.product_reference, true)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
project.save
puts 'ShareExtension added'
